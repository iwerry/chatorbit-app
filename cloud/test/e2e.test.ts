// End-to-end test with a fake OpenRouter and a fake Stripe: accounts, credits, chat streaming,
// images, video jobs, audio, checkout and webhooks.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64').toString('base64')
let fakeOr: Server, fakeStripe: Server, base = ''
const seen: { path: string; body: any; auth?: string }[] = []
let videoPolls = 0

function listen(s: Server) {
  return new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
}

before(async () => {
  fakeOr = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined
      seen.push({ path: req.url!, body, auth: req.headers.authorization })
      const j = (o: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)))
      const url = req.url!
      if (url === '/models')
        return j({ data: [
          { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', created: 3, context_length: 400000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0.00000125', completion: '0.00001' } },
          { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', created: 2, architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.000003', completion: '0.000015' } },
          { id: 'meta-llama/llama-4:free', name: 'Llama free', created: 9, architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
          { id: 'google/gemini-3-flash-image', name: 'Gemini Image', created: 1, architecture: { output_modalities: ['text', 'image'] }, pricing: { prompt: '0.0000003', completion: '0.0000025' } },
        ] })
      if (url === '/images/models') return j({ data: [{ id: 'bytedance-seed/seedream-4.5', name: 'Seedream 4.5', pricing: { image: '0.04' } }] })
      if (url === '/videos/models') return j({ data: [{ id: 'google/veo-3.1-fast', name: 'Veo 3.1 Fast', supported_durations: [4, 6, 8], supported_resolutions: ['720p', '1080p'], supported_aspect_ratios: ['16:9', '9:16'], pricing_skus: [{ price: 0.1, unit: 'second' }], allowed_passthrough_parameters: ['generate_audio'] }] })
      if (url === '/chat/completions') {
        if (!body.stream) return j({ id: 'gen-1', choices: [{ message: { role: 'assistant', content: 'hi' } }], usage: { cost: 0.002 } })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ id: 'gen-2', choices: [{ delta: { content: 'Hel' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'gen-2', choices: [{ delta: { content: 'lo' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'gen-2', choices: [], usage: { cost: 0.004 } })}\n\n`)
        return res.end('data: [DONE]\n\n')
      }
      if (url === '/images') return j({ id: 'img-1', data: [{ b64_json: PNG, media_type: 'image/png' }], usage: { cost: 0.04 } })
      if (url === '/videos' && req.method === 'POST') return (res.writeHead(202, { 'Content-Type': 'application/json' }), res.end(JSON.stringify({ id: 'vid-1', status: 'pending', polling_url: 'x' })))
      if (url === '/videos/vid-1') {
        videoPolls++
        return j(videoPolls < 2 ? { id: 'vid-1', status: 'in_progress' } : { id: 'vid-1', status: 'completed', generation_id: 'g-v', unsigned_urls: ['u0'], usage: { cost: 0.6 } })
      }
      if (url.startsWith('/videos/vid-1/content')) return (res.writeHead(200, { 'Content-Type': 'video/mp4' }), res.end(Buffer.from('MP4DATA')))
      if (url === '/audio/speech') return (res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'X-Generation-Id': 'gen-tts' }), res.end(Buffer.from('ID3audio')))
      if (url.startsWith('/generation?id=gen-tts')) return j({ data: { total_cost: 0.001 } })
      if (url === '/audio/transcriptions') return j({ text: 'olá mundo', usage: { cost: 0.0006 } })
      res.writeHead(404).end('{}')
    })
  })
  fakeStripe = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      seen.push({ path: `stripe:${req.url}`, body: raw })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === '/v1/customers') return res.end(JSON.stringify({ id: 'cus_1' }))
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }))
      if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ url: 'https://billing.stripe.test/p' }))
      res.end('{}')
    })
  })
  const orPort = await listen(fakeOr)
  const stPort = await listen(fakeStripe)
  Object.assign(process.env, {
    DB_FILE: join(mkdtempSync(join(tmpdir(), 'orbi-cloud-')), 't.db'),
    OPENROUTER_API_KEY: 'sk-test',
    OPENROUTER_BASE: `http://127.0.0.1:${orPort}`,
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_BASE: `http://127.0.0.1:${stPort}`,
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_PACK_S: 'price_pack_s',
    ADMIN_TOKEN: 'admin',
    TRIAL_CREDITS: '300',
    MARKUP: '1.25',
    CREDIT_USD: '0.001',
  })
  const { server } = await import('../src/server.ts')
  const port = await listen(server)
  base = `http://127.0.0.1:${port}`
  process.env.PUBLIC_URL = base
})
after(() => {
  fakeOr.close()
  fakeStripe.close()
  setTimeout(() => process.exit(0), 50)
})

let token = ''
const call = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const r = await fetch(base + path, { ...init, method: init.method || (init.json !== undefined ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: init.json !== undefined ? JSON.stringify(init.json) : undefined })
  return r
}
const credits = async () => ((await (await call('/me')).json()) as any).user.credits.total as number

test('signup gives trial credits; login and bad login', async () => {
  let r = await call('/auth/signup', { json: { email: 'Ana@Test.com', password: 'secret123', name: 'Ana' } })
  assert.equal(r.status, 200)
  const j: any = await r.json()
  token = j.token
  assert.equal(j.user.email, 'ana@test.com')
  assert.equal(j.user.credits.total, 300)
  r = await call('/auth/signup', { json: { email: 'ana@test.com', password: 'secret123' } })
  assert.equal(r.status, 409)
  const t = token
  token = ''
  r = await call('/auth/login', { json: { email: 'ana@test.com', password: 'nope' } })
  assert.equal(r.status, 401)
  r = await call('/me')
  assert.equal(r.status, 401)
  r = await call('/auth/login', { json: { email: 'ana@test.com', password: 'secret123' } })
  assert.equal(r.status, 200)
  token = t
})

test('catalog hides free models and prices in credits', async () => {
  const c: any = await (await call('/v1/catalog')).json()
  assert.ok(c.chat.some((m: any) => m.id === 'openai/gpt-5'))
  assert.ok(!c.chat.some((m: any) => m.id.endsWith(':free')))
  assert.equal(c.video[0].id, 'google/veo-3.1-fast')
  assert.equal(Math.round(c.video[0].pricePerSecond), 125) // 0.1 USD × 1.25 / 0.001
  const list: any = await (await call('/v1/models')).json()
  assert.ok(list.data.some((m: any) => m.id === 'bytedance-seed/seedream-4.5' && m.architecture.output_modalities.includes('image')))
})

test('streaming chat passes through and charges the reported cost with markup', async () => {
  const before = await credits()
  const r = await call('/v1/chat/completions', { json: { model: 'openai/gpt-5', stream: true, messages: [{ role: 'user', content: 'hi' }] } })
  const text = await r.text()
  assert.match(text, /Hel/)
  assert.match(text, /\[DONE\]/)
  await new Promise((s) => setTimeout(s, 50))
  const sent = seen.find((x) => x.path === '/chat/completions')!
  assert.equal(sent.auth, 'Bearer sk-test')
  assert.equal(sent.body.user.length > 0, true)
  assert.deepEqual(sent.body.usage, { include: true })
  assert.equal(Math.round((before - (await credits())) * 100) / 100, 5) // 0.004 × 1.25 / 0.001
})

test('image, speech and transcription are charged', async () => {
  let before = await credits()
  const img: any = await (await call('/v1/images', { json: { model: 'bytedance-seed/seedream-4.5', prompt: 'a fox' } })).json()
  assert.equal(img.data[0].media_type, 'image/png')
  assert.equal(Math.round(before - (await credits())), 50)
  before = await credits()
  const sp = await call('/v1/audio/speech', { json: { model: 'openai/gpt-4o-mini-tts-2025-12-15', input: 'oi', voice: 'alloy' } })
  assert.equal(Buffer.from(await sp.arrayBuffer()).toString(), 'ID3audio')
  await new Promise((s) => setTimeout(s, 900))
  assert.equal(Math.round((before - (await credits())) * 100) / 100, 1.25)
  const tr: any = await (await call('/v1/audio/transcriptions', { json: { model: 'openai/gpt-4o-mini-transcribe', input_audio: { data: 'AAA', format: 'wav' } } })).json()
  assert.equal(tr.text, 'olá mundo')
})

test('video: needs enough credits, then polls, charges once, downloads', async () => {
  // Veo fast at 125 credits/s × 8 s = 1000 credits; the trial balance is lower.
  let r = await call('/v1/videos', { json: { model: 'google/veo-3.1-fast', prompt: 'waves', duration: 8 } })
  assert.equal(r.status, 402)
  token = 'admin'
  r = await call('/admin/grant', { json: { email: 'ana@test.com', credits: 2000 } })
  assert.equal(r.status, 200)
  token = ((await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@test.com', password: 'secret123' }) })).json()) as any).token
  const before = await credits()
  const job: any = await (await call('/v1/videos', { json: { model: 'google/veo-3.1-fast', prompt: 'waves', duration: 8 } })).json()
  assert.equal(job.id, 'vid-1')
  let s: any = await (await call('/v1/videos/vid-1')).json()
  assert.equal(s.status, 'in_progress')
  s = await (await call('/v1/videos/vid-1')).json()
  assert.equal(s.status, 'completed')
  assert.match(s.outputs[0], /\/v1\/videos\/vid-1\/content\?index=0$/)
  await call('/v1/videos/vid-1')
  assert.equal(Math.round(before - (await credits())), 750) // charged once: 0.6 × 1.25 / 0.001
  const bin = await call('/v1/videos/vid-1/content?index=0')
  assert.equal(Buffer.from(await bin.arrayBuffer()).toString(), 'MP4DATA')
})

test('another user cannot read my video', async () => {
  const mine = token
  const j: any = await (await call('/auth/signup', { json: { email: 'bob@test.com', password: 'secret123' } })).json()
  token = j.token
  assert.equal((await call('/v1/videos/vid-1')).status, 404)
  token = mine
})

const sign = (payload: string) => {
  const t = Math.floor(Date.now() / 1000)
  return `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.${payload}`).digest('hex')}`
}
const hook = (evt: unknown, sig?: string) => {
  const raw = JSON.stringify(evt)
  return fetch(base + '/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig ?? sign(raw) }, body: raw })
}

test('subscription checkout, webhooks, monthly credits and extra packs', async () => {
  // packs need a plan first
  let r = await call('/billing/checkout', { json: { item: 'pack-s' } })
  assert.equal(r.status, 400)
  r = await call('/billing/checkout', { json: { item: 'pro' } })
  const co: any = await r.json()
  assert.equal(co.url, 'https://checkout.stripe.test/cs_1')
  const sent = seen.filter((x) => x.path === 'stripe:/v1/checkout/sessions').pop()!.body as string
  assert.match(decodeURIComponent(sent), /mode=subscription/)
  assert.match(decodeURIComponent(sent), /line_items\[0\]\[price\]=price_pro/)

  const me1: any = await (await call('/me')).json()
  const uid = me1.user.id
  assert.equal((await hook({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } }, 't=1,v1=00')).status, 400)
  assert.equal((await hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: uid, metadata: { user_id: uid, item: 'pro' } } } })).status, 200)
  const inv = { id: 'evt_2', type: 'invoice.paid', data: { object: { id: 'in_1', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ pricing: { price_details: { price: 'price_pro' } }, period: { end: 1900000000 } }] } } } }
  assert.equal((await hook(inv)).status, 200)
  assert.equal(((await (await hook(inv)).json()) as any).result, 'duplicate')
  const me2: any = await (await call('/me')).json()
  assert.equal(me2.user.plan.id, 'pro')
  assert.equal(me2.user.credits.plan, 15000)

  r = await call('/billing/checkout', { json: { item: 'pack-s' } })
  assert.equal(r.status, 200)
  await hook({ id: 'evt_3', type: 'checkout.session.completed', data: { object: { id: 'cs_2', mode: 'payment', payment_status: 'paid', client_reference_id: uid, metadata: { user_id: uid, item: 'pack-s' } } } })
  const me3: any = await (await call('/me')).json()
  assert.equal(Math.round(me3.user.credits.extra), Math.round(me2.user.credits.extra + 5000))

  await hook({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [] } } } })
  const me4: any = await (await call('/me')).json()
  assert.equal(me4.user.plan, null)
  assert.equal(me4.user.credits.plan, 0)
  assert.equal(Math.round(me4.user.credits.extra), Math.round(me3.user.credits.extra))
  const usage: any = await (await call('/me/usage')).json()
  assert.ok(usage.items.some((x: any) => x.kind === 'purchase'))
})

test('out of credits blocks chat with 402', async () => {
  const j: any = await (await call('/auth/signup', { json: { email: 'zero@test.com', password: 'secret123' } })).json()
  const mine = token
  token = j.token
  // spend the trial on images (50 each)
  for (let i = 0; i < 6; i++) await call('/v1/images', { json: { model: 'bytedance-seed/seedream-4.5', prompt: 'x' } })
  const r = await call('/v1/chat/completions', { json: { model: 'openai/gpt-5', messages: [] } })
  assert.equal(r.status, 402)
  const e: any = await r.json()
  assert.equal(e.error.code, 'no_credits')
  token = mine
})
