// Orbi Cloud HTTP server. Run: npm start (reads .env).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { config, MICRO } from './config.ts'
import { db } from './db.ts'
import { credit, getUser, HttpError, login, logout, publicUser, signup, userByEmail, userFromToken, usageOf } from './accounts.ts'
import { catalog, chat, image, modelList, speech, transcribe, videoContent, videoStatus, videoSubmit } from './openrouter.ts'
import { checkout, handleEvent, paymentsEnabled, portal, verify } from './stripe.ts'
import { tx } from './db.ts'

const MAX_BODY = 40 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large.', 'too_large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
async function json(req: IncomingMessage): Promise<Record<string, any>> {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'Body must be JSON.', 'bad_json')
  }
}
const send = (res: ServerResponse, status: number, body: unknown) => {
  if (res.headersSent) return res.end()
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const bearer = (req: IncomingMessage) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || undefined
const me = (req: IncomingMessage) => userFromToken(bearer(req))
const device = (req: IncomingMessage) => String(req.headers['x-orbi-device'] || req.headers['user-agent'] || '')

// Small per-user limit on parallel generations, so one account cannot flood the key.
const running = new Map<string, number>()
async function limited<T>(userId: string, fn: () => Promise<T>, max = 6): Promise<T> {
  const n = running.get(userId) || 0
  if (n >= max) throw new HttpError(429, 'Too many requests at once. Wait for one to finish.', 'busy')
  running.set(userId, n + 1)
  try {
    return await fn()
  } finally {
    running.set(userId, (running.get(userId) || 1) - 1)
  }
}

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121416;color:#f0f2ef;font:16px/1.5 system-ui,sans-serif}main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#a2aaa5}b{color:#bce64a}</style><main><h1>${title}</h1><p>${text}</p></main>`

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<unknown> | unknown
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/health$/, () => ({ ok: true, openrouter: !!config.openrouterKey, payments: paymentsEnabled() })],

  // accounts
  ['POST', /^\/auth\/signup$/, async (req) => { const b = await json(req); return signup(b.email, b.password, b.name, device(req)) }],
  ['POST', /^\/auth\/login$/, async (req) => { const b = await json(req); return login(b.email, b.password, device(req)) }],
  ['POST', /^\/auth\/logout$/, (req) => { const t = bearer(req); if (t) logout(t); return { ok: true } }],
  ['GET', /^\/me$/, (req) => ({ user: publicUser(me(req)), payments: paymentsEnabled() })],
  ['GET', /^\/me\/usage$/, (req) => ({ items: usageOf(me(req).id) })],

  // billing
  ['GET', /^\/billing\/plans$/, () => ({
    payments: paymentsEnabled(),
    plans: config.plans.map(({ id, name, priceLabel, monthlyCredits, features, stripePrice }) => ({ id, name, priceLabel, monthlyCredits, features, available: !!stripePrice })),
    packs: config.packs.map(({ id, name, priceLabel, credits, stripePrice }) => ({ id, name, priceLabel, credits, available: !!stripePrice })),
    credit: { usd: config.creditUsd },
  })],
  ['POST', /^\/billing\/checkout$/, async (req) => { const b = await json(req); return checkout(me(req), String(b.item || '')) }],
  ['POST', /^\/billing\/portal$/, (req) => portal(me(req))],
  ['GET', /^\/billing\/done$/, (req, res) => {
    const ok = new URL(req.url || '', 'http://x').searchParams.get('ok') === '1'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(ok ? page('Tudo certo!', 'Seu pagamento foi confirmado. Volte para o <b>Orbi</b> — seus créditos aparecem em instantes.') : page('Pagamento cancelado', 'Nada foi cobrado. Você pode fechar esta janela e voltar para o Orbi.'))
  }],
  ['POST', /^\/stripe\/webhook$/, async (req) => {
    const raw = await readBody(req)
    verify(raw, req.headers['stripe-signature'] as string | undefined)
    return { result: handleEvent(JSON.parse(raw)) }
  }],

  // AI gateway (OpenAI/OpenRouter-compatible paths)
  ['GET', /^\/v1\/models$/, (req) => (me(req), modelList())],
  ['GET', /^\/v1\/catalog$/, (req) => (me(req), catalog())],
  ['POST', /^\/v1\/chat\/completions$/, async (req, res) => { const u = me(req); const b = await json(req); await limited(u.id, () => chat(u, b, res)); return undefined }],
  ['POST', /^\/v1\/images$/, async (req) => { const u = me(req); const b = await json(req); return limited(u.id, () => image(u, b)) }],
  ['POST', /^\/v1\/videos$/, async (req) => { const u = me(req); const b = await json(req); return videoSubmit(u, b) }],
  ['GET', /^\/v1\/videos\/([^/]+)$/, (req, _res, p) => videoStatus(me(req), decodeURIComponent(p[0]))],
  ['GET', /^\/v1\/videos\/([^/]+)\/content$/, async (req, res, p) => {
    const idx = Number(new URL(req.url || '', 'http://x').searchParams.get('index') || 0)
    await videoContent(me(req), decodeURIComponent(p[0]), idx, res)
    return undefined
  }],
  ['POST', /^\/v1\/audio\/speech$/, async (req, res) => { const u = me(req); const b = await json(req); await limited(u.id, () => speech(u, b, res)); return undefined }],
  ['POST', /^\/v1\/audio\/transcriptions$/, async (req) => { const u = me(req); const b = await json(req); return limited(u.id, () => transcribe(u, b)) }],

  // admin
  ['POST', /^\/admin\/grant$/, async (req) => {
    if (!config.adminToken || bearer(req) !== config.adminToken) throw new HttpError(403, 'Admin only.', 'forbidden')
    const b = await json(req)
    const u = userByEmail(String(b.email || ''))
    if (!u) throw new HttpError(404, 'No account with that email.', 'not_found')
    tx(() => credit(u.id, b.bucket === 'plan' ? 'plan' : 'extra', Math.round(Number(b.credits || 0) * MICRO), 'grant', String(b.note || 'Granted by admin')))
    return { user: publicUser(getUser(u.id)!) }
  }],
  ['GET', /^\/admin\/stats$/, (req) => {
    if (!config.adminToken || bearer(req) !== config.adminToken) throw new HttpError(403, 'Admin only.', 'forbidden')
    return {
      users: (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n,
      subscribers: (db.prepare("SELECT COUNT(*) n FROM users WHERE plan_status IN ('active','trialing','past_due')").get() as { n: number }).n,
      usage30d: db.prepare("SELECT ROUND(SUM(cost_usd), 4) cost, COUNT(*) calls FROM ledger WHERE kind = 'usage' AND created_at > ?").get(Date.now() - 30 * 86400000),
    }
  }],
]

export const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Orbi-Device')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  const path = (req.url || '/').split('?')[0]
  try {
    for (const [method, re, handler] of routes) {
      const m = path.match(re)
      if (m && method === req.method) {
        const out = await handler(req, res, m.slice(1))
        if (out !== undefined) send(res, 200, out)
        else if (!res.writableEnded && !res.headersSent) send(res, 204, {})
        return
      }
    }
    send(res, 404, { error: { message: 'Not found', code: 'not_found' } })
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, String((e as Error)?.message || e), 'server')
    if (!(e instanceof HttpError)) console.error(e)
    if (res.headersSent) {
      // Mid-stream failure: tell the SSE client, then close.
      try {
        res.write(`data: ${JSON.stringify({ error: { message: err.message, code: err.code } })}\n\n`)
      } catch {
        /* closed */
      }
      return res.end()
    }
    send(res, err.status, { error: { message: err.message, code: err.code } })
  }
})
