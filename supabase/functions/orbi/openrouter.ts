// Gateway to OpenRouter: chat, images, video, speech and transcription, metered in credits.
// The OpenRouter key never leaves Supabase. Each call is charged with the cost OpenRouter reports
// (usage.cost, or the generation lookup), times the markup.
import { chargeFor, config, creditsFor, HttpError } from './config.ts'
import { debit, requireCredits, sql } from './db.ts'
import type { Caller } from './auth.ts'

const headers = (json = true): Record<string, string> => ({
  Authorization: `Bearer ${config.openrouterKey}`,
  'HTTP-Referer': config.appUrl,
  'X-Title': config.appName,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})

async function orFetch(path: string, init: RequestInit = {}) {
  if (!config.openrouterKey) throw new HttpError(503, 'Orbi Cloud is not configured yet (missing OpenRouter key on the server).', 'not_configured')
  return fetch(`${config.openrouterBase}${path}`, { ...init, headers: { ...headers(typeof init.body === 'string'), ...(init.headers as Record<string, string> | undefined) } })
}

async function orError(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  let msg = text
  try {
    const j = JSON.parse(text)
    msg = j.error?.message || j.message || text
  } catch {
    /* text */
  }
  if (res.status === 402) {
    console.error(`[orbi] OpenRouter balance: ${msg}`)
    throw new HttpError(503, 'Orbi Cloud ran out of AI balance (OpenRouter). An admin needs to add credits at openrouter.ai/settings/credits.', 'upstream_balance')
  }
  throw new HttpError(res.status === 401 || res.status === 403 ? 502 : res.status, msg || `OpenRouter error ${res.status}`, 'upstream')
}

async function costOf(generationId: string, tries = 4): Promise<number> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 600 * (i + 1)))
    try {
      const r = await orFetch(`/generation?id=${encodeURIComponent(generationId)}`)
      if (r.ok) {
        const j = (await r.json()) as { data?: { total_cost?: number } }
        if (typeof j.data?.total_cost === 'number') return j.data.total_cost
      }
    } catch {
      /* retry */
    }
  }
  return 0
}

const charge = (c: Caller, costUsd: number, model: string, note: string, ref = '') => debit(c.id, chargeFor(costUsd), costUsd, model, note, ref)

// ---------------------------------------------------------------- catalog

type OrModel = { id: string; name: string; created?: number; context_length?: number; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; pricing?: Record<string, string | number> }
// Vendors in the order people look for them (ChatGPT, Claude, Gemini, DeepSeek, Kimi, Grok…).
const VENDORS = ['openai', 'anthropic', 'google', 'deepseek', 'moonshotai', 'x-ai', 'qwen', 'meta-llama', 'mistralai', 'z-ai', 'minimax', 'perplexity', 'cohere', 'amazon', 'microsoft', 'nvidia']
// The newest general models of these vendors are shown first as "Popular" (two each).
const POPULAR_CHAT = ['openai', 'anthropic', 'google', 'deepseek', 'moonshotai', 'x-ai', 'qwen', 'meta-llama', 'mistralai', 'z-ai']
const NOT_GENERAL = /audio|image|embed|guard|tts|transcri|realtime|moderation|research|search|oss|codex|vl\b|-vl-|coder|instruct-\d|distill|safety|\bmini-?tts|lite-preview/i
// Best-known image and video models first, in this order.
const POPULAR_IMAGE = [/gemini.*image|nano.?banana/i, /gpt.*image/i, /flux/i, /seedream/i, /grok.*imag/i, /qwen.*image/i, /recraft/i, /ideogram/i, /imagen/i]
const POPULAR_VIDEO = [/veo/i, /sora/i, /kling/i, /seedance/i, /wan/i, /hailuo|minimax/i, /runway|gen-?4/i, /ray|luma/i, /pixverse/i, /grok/i]
const rankBy = (pats: RegExp[], id: string, name = '') => {
  const i = pats.findIndex((p) => p.test(id) || p.test(name))
  return i < 0 ? pats.length : i
}
const vendorRank = (id: string) => {
  const i = VENDORS.indexOf(vendorOf(id))
  return i < 0 ? VENDORS.length : i
}
// Voice models in order of preference (best quality for the price first). The rest follow, newest first.
const TTS_ORDER = ['google/gemini-3.8-flash-tts', 'elevenlabs/eleven-v4', 'elevenlabs/eleven-v4-turbo', 'fish-audio/s2.1-pro', 'microsoft/mai-voice-2.1', 'minimax/speech-2.8-hd', 'x-ai/grok-voice-tts-1.0', 'google/gemini-3.8-flash-lite-tts', 'microsoft/mai-voice-2.1-flash', 'qwen/qwen-audio-3.0-tts-plus', 'minimax/speech-2.8-turbo', 'mistralai/voxtral-mini-tts-3-0']
const STT_ORDER = ['openai/gpt-4o-mini-transcribe', 'google/gemini-3.5-transcribe', 'openai/gpt-transcribe', 'openai/gpt-4o-transcribe', 'mistralai/voxtral-mini-transcribe-3-0', 'x-ai/grok-stt-1.0', 'openai/whisper-large-v3-turbo', 'openai/whisper-large-v3']
const byOrder = (order: string[]) => (a: { id: string; created?: number }, b: { id: string; created?: number }) => {
  const ia = order.indexOf(a.id)
  const ib = order.indexOf(b.id)
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (b.created || 0) - (a.created || 0)
}

// USD per second of video at a resolution, from OpenRouter's price list (several formats exist).
function videoUsdPerSecond(skus: unknown, res: string, audio = true): number | undefined {
  if (!skus || typeof skus !== 'object') return undefined
  const k = skus as Record<string, string>
  const n = (key: string) => (k[key] !== undefined ? Number(k[key]) : undefined)
  const a = audio ? 'with_audio' : 'without_audio'
  const usd =
    n(`duration_seconds_${a}_${res}`) ?? n(`duration_seconds_${a}`) ?? n(`duration_seconds_${res}`) ?? n(`text_to_video_duration_seconds_${res}`) ?? n('duration_seconds') ?? n(`duration_seconds_${a}_720p`)
  if (usd !== undefined) return usd
  const cents = n(`cents_per_video_output_second_${res}`) ?? n(`cents_per_second_output_${res}`) ?? n('cents_per_second_output') ?? n('cents_per_video_output_second_720p')
  if (cents !== undefined) return cents / 100
  // Token-priced (Seedance): about width × height × 24 fps / 1024 tokens per second.
  const tok = n(`video_tokens_${res}`) ?? n('video_tokens')
  if (tok !== undefined) {
    const px = res === '1080p' ? 1920 * 1080 : res === '480p' ? 854 * 480 : 1280 * 720
    return (tok * px * 24) / 1024
  }
  const vals = Object.values(k).map(Number).filter((x) => x > 0)
  return vals.length ? Math.min(...vals) : undefined
}

// USD for one image, from the endpoint price list (per image, or per output token ≈ 1,120 tokens for a 1K image).
async function imageUsd(id: string): Promise<number | undefined> {
  try {
    const r = await fetch(`${config.openrouterBase}/images/models/${id}/endpoints`)
    if (!r.ok) return undefined
    const j = (await r.json()) as { endpoints?: { pricing?: { billable: string; unit: string; cost_usd: number }[] }[] }
    const prices = (j.endpoints || []).map((e) => {
      const out = (e.pricing || []).filter((p) => /output/.test(p.billable) || p.unit === 'image')
      if (!out.length) return undefined
      return out.reduce((sum, p) => sum + (p.unit === 'token' ? p.cost_usd * 1120 : p.unit === 'megapixel' ? p.cost_usd : p.cost_usd), 0)
    }).filter((x): x is number => typeof x === 'number' && x > 0)
    return prices.length ? Math.min(...prices) : undefined
  } catch {
    return undefined
  }
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v || 0)) || 0
const vendorOf = (id: string) => id.split('/')[0]
const isFree = (m: OrModel) => m.id.endsWith(':free') || (num(m.pricing?.prompt) === 0 && num(m.pricing?.completion) === 0 && num(m.pricing?.request) === 0 && m.id !== 'openrouter/auto')

// Model lists are public on OpenRouter, so they load even before the key is set on the server.
async function listJson<T>(path: string): Promise<T[]> {
  try {
    const r = await fetch(`${config.openrouterBase}${path}`, { headers: config.openrouterKey ? headers(false) : { 'HTTP-Referer': config.appUrl, 'X-Title': config.appName } })
    if (!r.ok) return []
    return ((await r.json()) as { data?: T[] }).data || []
  } catch {
    return []
  }
}

let cache: { at: number; data: Catalog } | null = null
export type Catalog = Awaited<ReturnType<typeof buildCatalog>>

async function buildCatalog() {
  const all = await listJson<OrModel & { supported_voices?: string[] | null }>('/models?output_modalities=all')
  const outs = (m: OrModel) => m.architecture?.output_modalities || ['text']
  let chat = all.filter((m) => outs(m).includes('text') && !isFree(m))
  if (config.chatModels.length) chat = config.chatModels.map((id) => chat.find((m) => m.id === id)).filter((m): m is OrModel => !!m)
  else {
    const per = new Map<string, number>()
    chat = chat
      .filter((m) => VENDORS.includes(vendorOf(m.id)))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .filter((m) => {
        const v = vendorOf(m.id)
        const k = per.get(v) || 0
        per.set(v, k + 1)
        return k < 8
      })
  }
  // Popular: the two newest general models of each main vendor.
  const popular = new Set<string>()
  for (const v of POPULAR_CHAT)
    chat
      .filter((m) => vendorOf(m.id) === v && !NOT_GENERAL.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .slice(0, 2)
      .forEach((m) => popular.add(m.id))
  chat = [...chat].sort((a, b) => vendorRank(a.id) - vendorRank(b.id) || Number(popular.has(b.id)) - Number(popular.has(a.id)) || (b.created || 0) - (a.created || 0))
  const imageRows = await listJson<OrModel & { supported_aspect_ratios?: string[]; supported_resolutions?: string[] }>('/images/models')
  const images = (imageRows.length ? imageRows : all.filter((m) => (m.architecture?.output_modalities || []).includes('image') && !m.id.endsWith(':free'))).sort(
    (a, b) => rankBy(POPULAR_IMAGE, a.id, a.name) - rankBy(POPULAR_IMAGE, b.id, b.name) || (b.created || 0) - (a.created || 0),
  )
  // Real cost per image: the endpoint price list, then what Orbi actually paid in the last 30 days.
  const paid = new Map<string, number>()
  try {
    const rows = await sql<{ model: string; avg: number }[]>`select model, avg(cost_usd)::float as avg from public.ledger where kind = 'usage' and note = 'Image' and cost_usd > 0 and created_at > now() - interval '30 days' group by model`
    for (const r of rows) paid.set(r.model, r.avg)
  } catch {
    /* no history yet */
  }
  const imagePrice = new Map<string, number | undefined>(await Promise.all(images.map(async (m) => [m.id, paid.get(m.id) ?? (await imageUsd(m.id))] as const)))
  const videoRowsAll = await listJson<{ id: string; name?: string; supported_durations?: number[]; supported_resolutions?: string[]; supported_aspect_ratios?: string[]; pricing_skus?: unknown; allowed_passthrough_parameters?: string[] }>('/videos/models')
  const videoRows = videoRowsAll.sort((a, b) => rankBy(POPULAR_VIDEO, a.id, a.name) - rankBy(POPULAR_VIDEO, b.id, b.name))
  const tts = all.filter((m) => outs(m).includes('speech') && !m.id.endsWith(':free')).sort(byOrder(TTS_ORDER))
  const stt = all.filter((m) => outs(m).includes('transcription') && !m.id.endsWith(':free')).sort(byOrder(STT_ORDER))
  return {
    chat: chat.map((m) => ({ id: m.id, name: m.name, vendor: vendorOf(m.id), featured: popular.has(m.id), created: m.created || 0, context: m.context_length || 0, input: m.architecture?.input_modalities || ['text'], image: (m.architecture?.output_modalities || []).includes('image'), price: { in: creditsFor(num(m.pricing?.prompt) * 1e6), out: creditsFor(num(m.pricing?.completion) * 1e6) }, usd: { in: num(m.pricing?.prompt) * 1e6, out: num(m.pricing?.completion) * 1e6 } })),
    image: images.map((m) => ({ id: m.id, name: m.name || m.id, vendor: vendorOf(m.id), featured: rankBy(POPULAR_IMAGE, m.id, m.name) < POPULAR_IMAGE.length, usd: imagePrice.get(m.id), price: imagePrice.get(m.id) ? creditsFor(imagePrice.get(m.id)!) : undefined, aspects: (m as { supported_aspect_ratios?: string[] }).supported_aspect_ratios, resolutions: (m as { supported_resolutions?: string[] }).supported_resolutions })),
    video: videoRows.map((m) => {
      const pps = videoUsdPerSecond(m.pricing_skus, '720p')
      const usdBySecond: Record<string, number> = {}
      for (const r of m.supported_resolutions || ['720p']) {
        const v = videoUsdPerSecond(m.pricing_skus, r)
        if (v !== undefined) usdBySecond[r] = v
      }
      return { id: m.id, usdPerSecond: pps, usdBySecond, name: m.name || m.id, vendor: vendorOf(m.id), featured: rankBy(POPULAR_VIDEO, m.id, m.name) < POPULAR_VIDEO.length, durations: m.supported_durations || [5], resolutions: m.supported_resolutions || ['720p'], aspects: m.supported_aspect_ratios || ['16:9', '9:16', '1:1'], audio: (m.allowed_passthrough_parameters || []).includes('generate_audio') || /veo|seedance|sora|wan|hailuo|grok/i.test(m.id), pricePerSecond: pps ? creditsFor(pps) : undefined, imageInput: true }
    }),
    // Voices: OpenRouter lists each model's voices. Price is per 1,000 characters (≈).
    tts: tts.map((m) => ({ id: m.id, name: m.name, vendor: vendorOf(m.id), voices: m.supported_voices || [], usd: num(m.pricing?.prompt) * 1000 + num(m.pricing?.completion) * 1000 })),
    // Dictation: price per minute of audio (≈; some models charge per token).
    stt: stt.map((m) => ({ id: m.id, name: m.name, vendor: vendorOf(m.id), usd: num(m.pricing?.completion) ? num(m.pricing?.prompt) * 1500 + num(m.pricing?.completion) * 200 : num(m.pricing?.prompt) * 60 })),
    // Music (Lyria: priced per clip / song) and sound effects (speech models that make any sound from a description).
    music: all.filter((m) => /lyria/i.test(m.id) && outs(m).includes('audio')).map((m) => ({ id: m.id, name: m.name, vendor: vendorOf(m.id), usd: /clip/.test(m.id) ? 0.04 : 0.08, seconds: /clip/.test(m.id) ? 30 : 180 })),
    sfx: tts.filter((m) => /seed-audio|sound|sfx|foley/i.test(m.id)).map((m) => ({ id: m.id, name: m.name, vendor: vendorOf(m.id), voices: m.supported_voices || [], usd: num(m.pricing?.completion) * 10 + num(m.pricing?.prompt) * 200 })),
    credits: { usd: config.creditUsd, markup: config.markup },
    _ok: all.length > 0,
  }
}

export async function catalog() {
  if (cache && Date.now() - cache.at < 30 * 60000) return cache.data
  const data = await buildCatalog()
  if (data._ok) cache = { at: Date.now(), data }
  return data
}

export async function modelList() {
  const c = await catalog()
  return {
    data: [
      ...c.chat.map((m) => ({ id: m.id, name: m.name, featured: m.featured, context_length: m.context, architecture: { input_modalities: m.input, output_modalities: m.image ? ['text', 'image'] : ['text'] } })),
      ...c.image.filter((m) => !c.chat.some((x) => x.id === m.id)).map((m) => ({ id: m.id, name: m.name, featured: m.featured, architecture: { output_modalities: ['image'] } })),
    ],
  }
}

// ---------------------------------------------------------------- chat

export async function chat(c: Caller, body: Record<string, unknown>): Promise<Response> {
  requireCredits(c.profile, 1)
  const model = String(body.model || '')
  if (!model || model.endsWith(':free')) throw new HttpError(400, 'Pick a model.', 'bad_model')
  const payload = { ...body, user: c.id, usage: { include: true }, ...(body.stream ? { stream_options: { include_usage: true } } : {}) }
  const up = await orFetch('/chat/completions', { method: 'POST', body: JSON.stringify(payload) })
  if (!up.ok) await orError(up)
  if (!body.stream) {
    const j = (await up.json()) as { id?: string; usage?: { cost?: number } }
    let cost = j.usage?.cost
    if (cost === undefined && j.id) cost = await costOf(j.id)
    await charge(c, cost || 0, model, 'Chat', j.id || '')
    return Response.json(j)
  }
  let cost: number | undefined
  let genId = ''
  let tail = ''
  const dec = new TextDecoder()
  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      ctl.enqueue(chunk)
      tail += dec.decode(chunk, { stream: true })
      const lines = tail.split('\n')
      tail = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:') || line.includes('[DONE]')) continue
        try {
          const j = JSON.parse(line.slice(5))
          if (j.id && !genId) genId = j.id
          if (typeof j.usage?.cost === 'number') cost = j.usage.cost
        } catch {
          /* partial line or keep-alive */
        }
      }
    },
    async flush() {
      if (cost === undefined && genId) cost = await costOf(genId)
      await charge(c, cost || 0, model, 'Chat', genId)
    },
  })
  return new Response(up.body!.pipeThrough(meter), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}

// ---------------------------------------------------------------- images

export async function image(c: Caller, body: Record<string, unknown>) {
  requireCredits(c.profile, 20)
  const model = String(body.model || '')
  const up = await orFetch('/images', { method: 'POST', body: JSON.stringify({ ...body, user: c.id }) })
  if (!up.ok) await orError(up)
  const j = (await up.json()) as { id?: string; usage?: { cost?: number } }
  let cost = j.usage?.cost
  if (cost === undefined && j.id) cost = await costOf(j.id)
  await charge(c, cost || 0, model, 'Image', j.id || '')
  return j
}

// ---------------------------------------------------------------- video (async jobs)

type VideoStatus = { id: string; status: string; generation_id?: string; usage?: { cost?: number }; error?: unknown; unsigned_urls?: string[]; urls?: string[] }
const publicJob = (j: VideoStatus) => ({ id: j.id, status: j.status, error: j.error, outputs: (j.unsigned_urls || j.urls || []).map((_, i) => `${config.publicUrl}/v1/videos/${encodeURIComponent(j.id)}/content?index=${i}`) })

export async function videoSubmit(c: Caller, body: Record<string, unknown>) {
  const cat = await catalog()
  const model = String(body.model || '')
  const m = cat.video.find((x) => x.id === model)
  const seconds = Number(body.duration || m?.durations?.[0] || 5)
  requireCredits(c.profile, m?.pricePerSecond ? Math.ceil(m.pricePerSecond * seconds) : 300)
  const up = await orFetch('/videos', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const j = (await up.json()) as VideoStatus
  await sql`insert into public.video_jobs (id, user_id, model, status) values (${j.id}, ${c.id}, ${model}, ${j.status || 'pending'})`
  return publicJob(j)
}

async function ownJob(c: Caller, id: string) {
  const [row] = await sql<{ id: string; model: string; charged: boolean }[]>`select id, model, charged from public.video_jobs where id = ${id} and user_id = ${c.id}`
  if (!row) throw new HttpError(404, 'Video not found.', 'not_found')
  return row
}

export async function videoStatus(c: Caller, id: string) {
  const row = await ownJob(c, id)
  const up = await orFetch(`/videos/${encodeURIComponent(id)}`)
  if (!up.ok) await orError(up)
  const j = (await up.json()) as VideoStatus
  await sql`update public.video_jobs set status = ${j.status} where id = ${id}`
  if ((j.status === 'completed' || j.status === 'failed') && !row.charged) {
    // Charge exactly once, even if two polls arrive together.
    const claimed = await sql`update public.video_jobs set charged = true where id = ${id} and charged = false returning id`
    if (claimed.length) {
      let cost = j.usage?.cost
      if (cost === undefined && j.status === 'completed' && j.generation_id) cost = await costOf(j.generation_id)
      await charge(c, cost || 0, row.model, 'Video', id)
    }
  }
  return publicJob(j)
}

export async function videoContent(c: Caller, id: string, index: number): Promise<Response> {
  await ownJob(c, id)
  const up = await orFetch(`/videos/${encodeURIComponent(id)}/content?index=${index}`)
  if (!up.ok) await orError(up)
  return new Response(up.body, { headers: { 'Content-Type': up.headers.get('content-type') || 'video/mp4' } })
}

// ---------------------------------------------------------------- audio

// Raw PCM (what Gemini TTS returns) becomes a playable WAV by adding a 44-byte header. No conversion, no cost.
export function wavFromPcm(pcm: Uint8Array, rate = 24000, channels = 1, bits = 16): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, x: string) => [...x].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, channels, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, (rate * channels * bits) / 8, true)
  v.setUint16(32, (channels * bits) / 8, true)
  v.setUint16(34, bits, true)
  str(36, 'data')
  v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}
// What a byte buffer is: a known audio file, or raw PCM that needs a WAV header.
function audioKind(b: Uint8Array): string | null {
  const head = String.fromCharCode(...b.slice(0, 4))
  if (head === 'RIFF') return 'audio/wav'
  if (head === 'fLaC') return 'audio/flac'
  if (head === 'OggS') return 'audio/ogg'
  if (head.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return 'audio/mp4'
  return null
}
// Voice models that only answer in PCM (learned on the first refusal).
const pcmOnly = new Set<string>(['google/gemini-3.8-flash-tts', 'google/gemini-3.8-flash-lite-tts', 'google/gemini-3.1-flash-tts-preview'])

export async function speech(c: Caller, body: Record<string, unknown>): Promise<Response> {
  requireCredits(c.profile, 1)
  // Older apps may ask for a voice model that no longer exists: use the best one and its first voice.
  const cat = await catalog()
  let model = cat.tts.find((m) => m.id === body.model)
  if (!model && cat.tts.length) model = cat.tts[0]
  if (model) {
    body.model = model.id
    if (model.voices.length && !model.voices.includes(String(body.voice || ''))) body.voice = model.voices[0]
  }
  const purpose = body.purpose
  delete body.purpose
  const id = String(body.model || '')
  const ask = (format: string) => orFetch('/audio/speech', { method: 'POST', body: JSON.stringify({ ...body, response_format: format }) })
  let pcm = pcmOnly.has(id)
  let up = await ask(pcm ? 'pcm' : String(body.response_format || 'mp3'))
  if (!up.ok && !pcm) {
    const text = await up.clone().text()
    if (/response_format/i.test(text) && /pcm/i.test(text)) {
      pcmOnly.add(id)
      pcm = true
      up = await ask('pcm')
    }
  }
  if (!up.ok) await orError(up)
  let buf = new Uint8Array(await up.arrayBuffer())
  let type = up.headers.get('content-type') || 'audio/mpeg'
  if (pcm || /pcm|L16/i.test(type) || !audioKind(buf)) {
    if (!audioKind(buf)) {
      const rate = Number(type.match(/rate=(\d+)/)?.[1]) || 24000
      buf = wavFromPcm(buf, rate, Number(type.match(/channels=(\d+)/)?.[1]) || 1)
    }
    type = audioKind(buf) || 'audio/wav'
  }
  const genId = up.headers.get('x-generation-id') || ''
  const cost = genId ? await costOf(genId) : 0
  await charge(c, cost, id, purpose === 'sfx' ? 'Sound effect' : 'Voice', genId)
  return new Response(buf, { headers: { 'Content-Type': type } })
}

// ---------------------------------------------------------------- music (Lyria through chat completions)

export async function music(c: Caller, body: Record<string, unknown>): Promise<Response> {
  requireCredits(c.profile, 50)
  const model = String(body.model || 'google/lyria-3-clip-preview')
  if (!/lyria|audio/i.test(model)) throw new HttpError(400, 'Pick a music model.', 'bad_model')
  const prompt = String(body.prompt || '').slice(0, 4000)
  if (!prompt) throw new HttpError(400, 'Describe the music.', 'bad_prompt')
  const up = await orFetch('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model, stream: true, modalities: ['text', 'audio'], audio: { format: String(body.format || 'wav') }, messages: [{ role: 'user', content: prompt }], user: c.id, usage: { include: true } }),
  })
  if (!up.ok) await orError(up)
  // Collect the base64 audio pieces from the stream.
  const reader = up.body!.getReader()
  const dec = new TextDecoder()
  let tail = ''
  const parts: string[] = []
  let text = ''
  let cost: number | undefined
  let genId = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    tail += dec.decode(value, { stream: true })
    const lines = tail.split('\n')
    tail = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue
      try {
        const j = JSON.parse(line.slice(5))
        if (j.id && !genId) genId = j.id
        if (typeof j.usage?.cost === 'number') cost = j.usage.cost
        const d = j.choices?.[0]?.delta || j.choices?.[0]?.message || {}
        if (d.audio?.data) parts.push(d.audio.data)
        if (typeof d.content === 'string') text += d.content
        if (d.audio?.transcript) text += d.audio.transcript
      } catch {
        /* partial line */
      }
    }
  }
  if (!parts.length) throw new HttpError(502, text.trim() ? `The model answered without music: ${text.trim().slice(0, 200)}` : 'No music came back. Try again in a moment.', 'no_audio')
  // Base64 pieces can be split anywhere: join the decoded bytes.
  const chunks = parts.map((p) => Uint8Array.from(atob(p), (ch) => ch.charCodeAt(0)))
  let buf = new Uint8Array(chunks.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const ch of chunks) {
    buf.set(ch, o)
    o += ch.length
  }
  if (!audioKind(buf)) buf = wavFromPcm(buf, 48000, 2)
  if (cost === undefined && genId) cost = await costOf(genId)
  await charge(c, cost || 0, model, 'Music', genId)
  return new Response(buf, { headers: { 'Content-Type': audioKind(buf) || 'audio/wav', 'X-Orbi-Lyrics': encodeURIComponent(text.slice(0, 1500)) } })
}

export async function transcribe(c: Caller, body: Record<string, unknown>) {
  requireCredits(c.profile, 1)
  const cat = await catalog()
  if (cat.stt.length && !cat.stt.some((m) => m.id === body.model)) body.model = cat.stt[0].id
  const up = await orFetch('/audio/transcriptions', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const genId = up.headers.get('x-generation-id') || ''
  const j = (await up.json()) as { text?: string; usage?: { cost?: number } }
  let cost = j.usage?.cost
  if (cost === undefined && genId) cost = await costOf(genId)
  await charge(c, cost || 0, String(body.model || ''), 'Dictation', genId)
  return j
}
