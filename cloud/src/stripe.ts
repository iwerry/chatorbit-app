// Stripe through its REST API (no SDK): checkout for plans and credit packs, the customer portal, and webhooks.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.ts'
import { db, tx, type User } from './db.ts'
import { credit, getUser, HttpError, resetPlanCredits } from './accounts.ts'
import { MICRO } from './config.ts'

const enabled = () => !!config.stripeKey

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
  if (!enabled()) throw new HttpError(503, 'Payments are not set up on this server yet.', 'payments_off')
  const res = await fetch(`${config.stripeBase}/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body).join('&') : undefined,
  })
  const j = (await res.json()) as T & { error?: { message?: string } }
  if (!res.ok) throw new HttpError(502, j.error?.message || `Stripe error ${res.status}`, 'stripe')
  return j
}

async function customerFor(u: User) {
  if (u.stripe_customer) return u.stripe_customer
  const c = await stripe<{ id: string }>('/customers', { email: u.email, name: u.name || undefined, metadata: { user_id: u.id } })
  db.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').run(c.id, u.id)
  return c.id
}

const hasPlan = (u: User) => !!u.plan && ['active', 'trialing', 'past_due'].includes(u.plan_status || '')

export async function checkout(u: User, item: string) {
  const plan = config.plans.find((p) => p.id === item)
  const pack = config.packs.find((p) => p.id === item)
  if (!plan && !pack) throw new HttpError(400, 'Unknown plan or credit pack.', 'bad_item')
  const price = plan?.stripePrice || pack?.stripePrice
  if (!price) throw new HttpError(503, `Price for "${item}" is not set on the server (${plan?.stripePriceEnv || pack?.stripePriceEnv}).`, 'payments_off')
  if (pack && !hasPlan(u)) throw new HttpError(400, 'Extra credits are for subscribers. Choose a plan first.', 'needs_plan')
  if (plan && hasPlan(u)) throw new HttpError(400, 'You already have a plan. Change it in Manage subscription.', 'has_plan')
  const customer = await customerFor(u)
  const s = await stripe<{ url: string; id: string }>('/checkout/sessions', {
    mode: plan ? 'subscription' : 'payment',
    customer,
    client_reference_id: u.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${config.publicUrl}/billing/done?ok=1`,
    cancel_url: `${config.publicUrl}/billing/done?ok=0`,
    allow_promotion_codes: 'true',
    metadata: { user_id: u.id, item },
    ...(plan ? { subscription_data: { metadata: { user_id: u.id, plan: plan.id } } } : { payment_intent_data: { metadata: { user_id: u.id, item } } }),
  })
  return { url: s.url, id: s.id }
}

export async function portal(u: User) {
  if (!u.stripe_customer) throw new HttpError(400, 'No subscription yet.', 'no_customer')
  const s = await stripe<{ url: string }>('/billing_portal/sessions', { customer: u.stripe_customer, return_url: `${config.publicUrl}/billing/done?ok=1` })
  return { url: s.url }
}

// ---------------------------------------------------------------- webhooks

export function verify(raw: string, header: string | undefined) {
  if (!config.stripeWebhookSecret) throw new HttpError(503, 'Webhook secret not set.', 'payments_off')
  const parts = Object.fromEntries((header || '').split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  const sigs = (header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!t || !sigs.length) throw new HttpError(400, 'Bad signature header.', 'bad_signature')
  if (Math.abs(Date.now() / 1000 - t) > 600) throw new HttpError(400, 'Signature too old.', 'bad_signature')
  const want = createHmac('sha256', config.stripeWebhookSecret).update(`${t}.${raw}`).digest()
  if (!sigs.some((s) => { const got = Buffer.from(s, 'hex'); return got.length === want.length && timingSafeEqual(got, want) })) throw new HttpError(400, 'Signature does not match.', 'bad_signature')
}

type Obj = Record<string, any>
const planByPrice = (price?: string) => config.plans.find((p) => p.stripePrice && p.stripePrice === price)
const userBySub = (sub?: string) => (sub ? (db.prepare('SELECT * FROM users WHERE subscription_id = ?').get(sub) as User | undefined) : undefined)
const userByCustomer = (c?: string) => (c ? (db.prepare('SELECT * FROM users WHERE stripe_customer = ?').get(c) as User | undefined) : undefined)

// Stripe moved some fields between API versions; read both places.
const invoiceSub = (inv: Obj): string | undefined => inv.subscription || inv.parent?.subscription_details?.subscription || inv.lines?.data?.[0]?.subscription || inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
const linePrice = (line: Obj): string | undefined => line?.price?.id || line?.pricing?.price_details?.price || line?.plan?.id
const subPeriodEnd = (sub: Obj): number | undefined => sub.current_period_end || sub.items?.data?.[0]?.current_period_end

export function handleEvent(evt: Obj) {
  const seen = db.prepare('INSERT OR IGNORE INTO stripe_events (id, created_at) VALUES (?, ?)').run(evt.id, Date.now())
  if (Number(seen.changes) === 0) return 'duplicate'
  const o = evt.data?.object as Obj
  switch (evt.type) {
    case 'checkout.session.completed': {
      const u = getUser(o.metadata?.user_id || o.client_reference_id)
      if (!u) return 'no user'
      if (o.mode === 'payment' && o.payment_status === 'paid') {
        const pack = config.packs.find((p) => p.id === o.metadata?.item)
        if (pack) tx(() => credit(u.id, 'extra', pack.credits * MICRO, 'purchase', pack.name, o.id))
      }
      if (o.mode === 'subscription' && o.subscription) {
        db.prepare("UPDATE users SET subscription_id = ?, stripe_customer = COALESCE(stripe_customer, ?), plan = COALESCE(?, plan), plan_status = 'active' WHERE id = ?").run(o.subscription, o.customer || null, o.metadata?.item || null, u.id)
      }
      return 'ok'
    }
    case 'invoice.paid': {
      const sub = invoiceSub(o)
      const u = userBySub(sub) || userByCustomer(o.customer)
      if (!u || !sub) return 'no user'
      const line = (o.lines?.data || []).find((l: Obj) => planByPrice(linePrice(l))) || o.lines?.data?.[0]
      const plan = planByPrice(linePrice(line)) || config.plans.find((p) => p.id === u.plan)
      if (!plan) return 'no plan'
      const end = line?.period?.end
      db.prepare("UPDATE users SET subscription_id = ?, plan = ?, plan_status = 'active', period_end = COALESCE(?, period_end) WHERE id = ?").run(sub, plan.id, end ? end * 1000 : null, u.id)
      resetPlanCredits(u.id, plan.monthlyCredits, o.id)
      return 'ok'
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const u = userBySub(o.id) || userByCustomer(o.customer) || getUser(o.metadata?.user_id)
      if (!u) return 'no user'
      const plan = planByPrice(linePrice(o.items?.data?.[0]))
      const status = evt.type === 'customer.subscription.deleted' ? 'canceled' : o.status
      const end = subPeriodEnd(o)
      db.prepare('UPDATE users SET subscription_id = ?, plan = COALESCE(?, plan), plan_status = ?, period_end = COALESCE(?, period_end) WHERE id = ?').run(o.id, plan?.id || null, status, end ? end * 1000 : null, u.id)
      // A canceled plan keeps nothing of its monthly credits; extra credits stay.
      if (status === 'canceled') db.prepare('UPDATE users SET plan_balance = MIN(plan_balance, 0) WHERE id = ?').run(u.id)
      return 'ok'
    }
    default:
      return 'ignored'
  }
}

export const paymentsEnabled = enabled
