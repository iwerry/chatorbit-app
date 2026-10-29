// Orbi Cloud request handler: one function, the same routes the Orbi apps use.
//   GET  /health                              status (public)
//   GET  /me · /me/usage                      account, credits, usage
//   GET  /billing/plans · POST /billing/checkout · /billing/portal · GET /billing/done
//   POST /stripe/webhook                      Stripe events (signature checked)
//   GET  /v1/models · /v1/catalog             market models (no free models)
//   POST /v1/chat/completions                 chat (OpenAI-compatible, streaming)
//   POST /v1/images · /v1/videos · GET /v1/videos/:id(/content)
//   POST /v1/audio/speech · /v1/audio/transcriptions · /v1/music
//   POST /admin/grant · GET /admin/stats      admins only (ADMIN_EMAILS)
import { config, HttpError, MICRO, packs, plans } from './config.ts'
import { caller, publicUser } from './auth.ts'
import { addCredits, profile, sql, type Profile } from './db.ts'
import { catalog, chat, image, modelList, music, speech, transcribe, videoContent, videoStatus, videoSubmit } from './openrouter.ts'
import { checkout, handleEvent, paymentsEnabled, portal, verify } from './stripe.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-orbi-device',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const withCors = (r: Response) => {
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v)
  return r
}
const body = async (req: Request) => {
  const raw = await req.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Body must be JSON.', 'bad_json')
  }
}

// Small per-instance limit on parallel generations per user.
const running = new Map<string, number>()
async function limited<T>(id: string, fn: () => Promise<T>, max = 6): Promise<T> {
  const k = running.get(id) || 0
  if (k >= max) throw new HttpError(429, 'Too many requests at once. Wait for one to finish.', 'busy')
  running.set(id, k + 1)
  try {
    return await fn()
  } finally {
    running.set(id, (running.get(id) || 1) - 1)
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/(functions\/v1\/)?orbi/, '') || '/'
  const M = req.method
  const is = (m: string, p: string | RegExp) => M === m && (typeof p === 'string' ? path === p : p.test(path))

  if (M === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (is('GET', '/health') || is('GET', '/')) return json({ ok: true, openrouter: !!config.openrouterKey, payments: paymentsEnabled() })

  // Pages people land on in the browser (Supabase shows function responses as plain text).
  if (is('GET', '/billing/done'))
    return new Response(url.searchParams.get('ok') === '1' ? 'Tudo certo! Seu pagamento foi confirmado.\nVolte para o Orbi — seus créditos aparecem em instantes.' : 'Pagamento cancelado. Nada foi cobrado.\nVocê pode fechar esta janela e voltar para o Orbi.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  if (is('GET', '/auth/done')) return new Response('E-mail confirmado!\nVolte para o Orbi e entre com seu e-mail e senha.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

  if (is('POST', '/stripe/webhook')) {
    const raw = await req.text()
    await verify(raw, req.headers.get('stripe-signature'))
    return json({ result: await handleEvent(JSON.parse(raw)) })
  }
  if (is('GET', '/billing/plans'))
    return json({
      payments: paymentsEnabled(),
      plans: plans.map(({ id, name, priceLabel, monthlyCredits, features, stripePrice }) => ({ id, name, priceLabel, monthlyCredits, features, available: !!stripePrice })),
      packs: packs.map(({ id, name, priceLabel, credits, stripePrice }) => ({ id, name, priceLabel, credits, available: !!stripePrice })),
      credit: { usd: config.creditUsd },
    })

  // Everything below needs a signed-in user.
  const c = await caller(req)
  if (is('GET', '/me')) return json({ user: publicUser(c), payments: paymentsEnabled() })
  if (is('GET', '/me/usage')) {
    const rows = await sql<{ created_at: Date; kind: string; amount: string; model: string; note: string }[]>`select created_at, kind, amount, model, note from public.ledger where user_id = ${c.id} order by id desc limit 100`
    return json({ items: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).getTime(), amount: Number(r.amount) / MICRO })) })
  }
  if (is('POST', '/billing/checkout')) return json(await checkout(c, String((await body(req)).item || '')))
  if (is('POST', '/billing/portal')) return json(await portal(c))

  if (is('GET', '/v1/models')) return json(await modelList())
  if (is('GET', '/v1/catalog')) return json(await catalog())
  if (is('POST', '/v1/chat/completions')) {
    const b = await body(req)
    return withCors(await limited(c.id, () => chat(c, b)))
  }
  if (is('POST', '/v1/images')) {
    const b = await body(req)
    return json(await limited(c.id, () => image(c, b)))
  }
  if (is('POST', '/v1/videos')) return json(await videoSubmit(c, await body(req)))
  let m = path.match(/^\/v1\/videos\/([^/]+)\/content$/)
  if (M === 'GET' && m) return withCors(await videoContent(c, decodeURIComponent(m[1]), Number(url.searchParams.get('index') || 0)))
  m = path.match(/^\/v1\/videos\/([^/]+)$/)
  if (M === 'GET' && m) return json(await videoStatus(c, decodeURIComponent(m[1])))
  if (is('POST', '/v1/audio/speech')) {
    const b = await body(req)
    return withCors(await limited(c.id, () => speech(c, b)))
  }
  if (is('POST', '/v1/music')) {
    const b = await body(req)
    return withCors(await limited(c.id, () => music(c, b), 3))
  }
  if (is('POST', '/v1/audio/transcriptions')) {
    const b = await body(req)
    return json(await limited(c.id, () => transcribe(c, b)))
  }

  if (is('POST', '/admin/grant') || is('GET', '/admin/stats')) {
    if (!c.admin) throw new HttpError(403, 'Admin only.', 'forbidden')
    if (M === 'GET') {
      const [u] = await sql`select count(*)::int as users, count(*) filter (where plan_status in ('active','trialing','past_due'))::int as subscribers from public.profiles`
      const [l] = await sql`select round(coalesce(sum(cost_usd),0)::numeric, 4)::float as cost, count(*)::int as calls from public.ledger where kind = 'usage' and created_at > now() - interval '30 days'`
      return json({ ...u, usage30d: l })
    }
    const b = await body(req)
    const [target] = await sql<Profile[]>`select * from public.profiles where lower(email) = ${String(b.email || '').toLowerCase()}`
    if (!target) throw new HttpError(404, 'No account with that email.', 'not_found')
    await addCredits(target.id, b.bucket === 'plan' ? 'plan' : 'extra', Math.round(Number(b.credits || 0) * MICRO), 'grant', String(b.note || 'Granted by admin'))
    const p = (await profile(target.id))!
    return json({ email: p.email, credits: (Number(p.plan_balance) + Number(p.extra_balance)) / MICRO })
  }
  return json({ error: { message: 'Not found', code: 'not_found' } }, 404)
}

export async function handler(req: Request): Promise<Response> {
  try {
    return await route(req)
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, String((e as Error)?.message || e), 'server')
    if (!(e instanceof HttpError)) console.error(e)
    return json({ error: { message: err.message, code: err.code } }, err.status)
  }
}

