// Stripe through its REST API: checkout for plans and credit packs, the customer portal, and webhooks.
import { config, HttpError, MICRO, packs, plans } from './config.ts'
import { addCredits, profile, resetPlanCredits, sql, type Profile } from './db.ts'
import type { Caller } from './auth.ts'

export const paymentsEnabled = () => !!config.stripeKey

function form(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? out.push(...form(x as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`)))
    else if (typeof v === 'object') out.push(...form(v as Record<string, unknown>, key))
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  return out
}

async function stripe<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  if (!paymentsEnabled()) throw new HttpError(503, 'Payments are not set up on this server yet.', 'payments_off')
  const res = await fetch(`${config.stripeBase}/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body).join('&') : undefined,
  })
  const j = (await res.json()) as T & { error?: { message?: string } }
  if (!res.ok) throw new HttpError(502, j.error?.message || `Stripe error ${res.status}`, 'stripe')
  return j
}

const hasPlan = (p: Profile) => !!p.plan && ['active', 'trialing', 'past_due'].includes(p.plan_status || '')

async function customerFor(c: Caller) {
  if (c.profile.stripe_customer) return c.profile.stripe_customer
  const cu = await stripe<{ id: string }>('/customers', { email: c.email, name: c.profile.name || undefined, metadata: { user_id: c.id } })
  await sql`update public.profiles set stripe_customer = ${cu.id} where id = ${c.id}`
  return cu.id
}

export async function checkout(c: Caller, item: string) {
  const plan = plans.find((p) => p.id === item)
  const pack = packs.find((p) => p.id === item)
  if (!plan && !pack) throw new HttpError(400, 'Unknown plan or credit pack.', 'bad_item')
  const price = plan?.stripePrice || pack?.stripePrice
  if (!price) throw new HttpError(503, 'Payments are not set up on this server yet.', 'payments_off')
  if (pack && !hasPlan(c.profile)) throw new HttpError(400, 'Extra credits are for subscribers. Choose a plan first.', 'needs_plan')
  if (plan && hasPlan(c.profile)) throw new HttpError(400, 'You already have a plan. Change it in Manage subscription.', 'has_plan')
  const customer = await customerFor(c)
  const s = await stripe<{ url: string; id: string }>('/checkout/sessions', {
    mode: plan ? 'subscription' : 'payment',
    customer,
    client_reference_id: c.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${config.publicUrl}/billing/done?ok=1`,
    cancel_url: `${config.publicUrl}/billing/done?ok=0`,
    allow_promotion_codes: 'true',
    metadata: { user_id: c.id, item },
    ...(plan ? { subscription_data: { metadata: { user_id: c.id, plan: plan.id } } } : { payment_intent_data: { metadata: { user_id: c.id, item } } }),
  })
  return { url: s.url, id: s.id }
}

export async function portal(c: Caller) {
  if (!c.profile.stripe_customer) throw new HttpError(400, 'No subscription yet.', 'no_customer')
  return { url: (await stripe<{ url: string }>('/billing_portal/sessions', { customer: c.profile.stripe_customer, return_url: `${config.publicUrl}/billing/done?ok=1` })).url }
}

// ---------------------------------------------------------------- webhooks

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function verify(raw: string, header: string | null) {
  if (!config.stripeWebhookSecret) throw new HttpError(503, 'Webhook secret not set.', 'payments_off')
  const parts = (header || '').split(',')
  const t = Number(parts.find((p) => p.startsWith('t='))?.slice(2))
  const sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!t || !sigs.length) throw new HttpError(400, 'Bad signature header.', 'bad_signature')
  if (Math.abs(Date.now() / 1000 - t) > 600) throw new HttpError(400, 'Signature too old.', 'bad_signature')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.stripeWebhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)))
  if (!sigs.includes(want)) throw new HttpError(400, 'Signature does not match.', 'bad_signature')
}

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>
const planByPrice = (price?: string) => plans.find((p) => p.stripePrice && p.stripePrice === price)
const one = async (q: Promise<Profile[]>) => (await q)[0]
const userBySub = (sub?: string) => (sub ? one(sql<Profile[]>`select * from public.profiles where subscription_id = ${sub}`) : Promise.resolve(undefined))
const userByCustomer = (cu?: string) => (cu ? one(sql<Profile[]>`select * from public.profiles where stripe_customer = ${cu}`) : Promise.resolve(undefined))
const userById = (id?: string) => (id && /^[0-9a-f-]{36}$/i.test(id) ? profile(id) : Promise.resolve(undefined))
const invoiceSub = (inv: Obj): string | undefined => inv.subscription || inv.parent?.subscription_details?.subscription || inv.lines?.data?.[0]?.subscription || inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
const linePrice = (line: Obj): string | undefined => line?.price?.id || line?.pricing?.price_details?.price || line?.plan?.id
const subPeriodEnd = (sub: Obj): number | undefined => sub.current_period_end || sub.items?.data?.[0]?.current_period_end
const ts = (sec?: number) => (sec ? new Date(sec * 1000) : null)

export async function handleEvent(evt: Obj) {
  const seen = await sql`insert into public.stripe_events (id) values (${evt.id}) on conflict do nothing returning id`
  if (!seen.length) return 'duplicate'
  const o = evt.data?.object as Obj
  switch (evt.type) {
    case 'checkout.session.completed': {
      const u = await userById(o.metadata?.user_id || o.client_reference_id)
      if (!u) return 'no user'
      if (o.mode === 'payment' && o.payment_status === 'paid') {
        const pack = packs.find((p) => p.id === o.metadata?.item)
        if (pack) await addCredits(u.id, 'extra', pack.credits * MICRO, 'purchase', pack.name, o.id)
      }
      if (o.mode === 'subscription' && o.subscription)
        await sql`update public.profiles set subscription_id = ${o.subscription}, stripe_customer = coalesce(stripe_customer, ${o.customer || null}), plan = coalesce(${o.metadata?.item || null}, plan), plan_status = 'active' where id = ${u.id}`
      return 'ok'
    }
    case 'invoice.paid': {
      const sub = invoiceSub(o)
      const u = (await userBySub(sub)) || (await userByCustomer(o.customer))
      if (!u || !sub) return 'no user'
      const line = (o.lines?.data || []).find((l: Obj) => planByPrice(linePrice(l))) || o.lines?.data?.[0]
      const plan = planByPrice(linePrice(line)) || plans.find((p) => p.id === u.plan)
      if (!plan) return 'no plan'
      await sql`update public.profiles set subscription_id = ${sub}, plan = ${plan.id}, plan_status = 'active', period_end = coalesce(${ts(line?.period?.end)}, period_end) where id = ${u.id}`
      await resetPlanCredits(u.id, plan.monthlyCredits, `Monthly credits (${plan.name})`, o.id)
      return 'ok'
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const u = (await userBySub(o.id)) || (await userByCustomer(o.customer)) || (await userById(o.metadata?.user_id))
      if (!u) return 'no user'
      const plan = planByPrice(linePrice(o.items?.data?.[0]))
      const status = evt.type === 'customer.subscription.deleted' ? 'canceled' : o.status
      await sql`update public.profiles set subscription_id = ${o.id}, plan = coalesce(${plan?.id || null}, plan), plan_status = ${status}, period_end = coalesce(${ts(subPeriodEnd(o))}, period_end) where id = ${u.id}`
      if (status === 'canceled') await sql`update public.profiles set plan_balance = least(plan_balance, 0) where id = ${u.id}`
      return 'ok'
    }
    default:
      return 'ignored'
  }
}
