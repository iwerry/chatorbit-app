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
const VENDORS = ['openai', 'anthropic', 'google', 'x-ai', 'deepseek', 'meta-llama', 'mistralai', 'qwen', 'moonshotai', 'z-ai', 'minimax', 'perplexity', 'cohere', 'amazon', 'microsoft', 'nvidia']
const TTS = [
  { id: 'openai/gpt-4o-mini-tts-2025-12-15', name: 'OpenAI GPT-4o mini TTS', voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] },
  { id: 'google/gemini-3.1-flash-tts-preview', name: 'Google Gemini 3.1 Flash TTS', voices: ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Aoede', 'Orus'] },
  { id: 'mistralai/voxtral-mini-tts-2603', name: 'Mistral Voxtral Mini TTS', voices: [] as string[] },
]
const STT = [
  { id: 'openai/gpt-4o-mini-transcribe', name: 'OpenAI GPT-4o mini Transcribe' },
  { id: 'openai/gpt-4o-transcribe', name: 'OpenAI GPT-4o Transcribe' },
  { id: 'openai/whisper-large-v3', name: 'Whisper large v3' },
  { id: 'google/chirp-3', name: 'Google Chirp 3' },
]
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v || 0)) || 0
const vendorOf = (id: string) => id.split('/')[0]
const isFree = (m: OrModel) => m.id.endsWith(':free') || (num(m.pricing?.prompt) === 0 && num(m.pricing?.completion) === 0 && num(m.pricing?.request) === 0 && m.id !== 'openrouter/auto')

async function listJson<T>(path: string): Promise<T[]> {
  try {
    const r = await orFetch(path)
    if (!r.ok) return []
    return ((await r.json()) as { data?: T[] }).data || []
  } catch {
    return []
  }
}

let cache: { at: number; data: Catalog } | null = null
export type Catalog = Awaited<ReturnType<typeof buildCatalog>>

async function buildCatalog() {
  const all = await listJson<OrModel>('/models')
  let chat = all.filter((m) => (m.architecture?.output_modalities || ['text']).includes('text') && !isFree(m))
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
  const imageRows = await listJson<OrModel & { supported_aspect_ratios?: string[]; supported_resolutions?: string[] }>('/images/models')
  const images = imageRows.length ? imageRows : all.filter((m) => (m.architecture?.output_modalities || []).includes('image') && !m.id.endsWith(':free'))
  const videoRows = await listJson<{ id: string; name?: string; supported_durations?: number[]; supported_resolutions?: string[]; supported_aspect_ratios?: string[]; pricing_skus?: unknown; allowed_passthrough_parameters?: string[] }>('/videos/models')
  const perSecond = (skus: unknown): number | undefined => {
    const list = Array.isArray(skus) ? skus : skus && typeof skus === 'object' ? Object.values(skus as object) : []
    const prices = list.map((s) => (typeof s === 'object' && s ? num((s as { price?: unknown; amount?: unknown }).price ?? (s as { amount?: unknown }).amount) : num(s))).filter((p) => p > 0)
    return prices.length ? Math.min(...prices) : undefined
  }
  return {
    chat: chat.map((m) => ({ id: m.id, name: m.name, vendor: vendorOf(m.id), context: m.context_length || 0, input: m.architecture?.input_modalities || ['text'], image: (m.architecture?.output_modalities || []).includes('image'), price: { in: creditsFor(num(m.pricing?.prompt) * 1e6), out: creditsFor(num(m.pricing?.completion) * 1e6) } })),
    image: images.map((m) => ({ id: m.id, name: m.name || m.id, vendor: vendorOf(m.id), price: num(m.pricing?.image) ? creditsFor(num(m.pricing?.image)) : undefined, aspects: (m as { supported_aspect_ratios?: string[] }).supported_aspect_ratios, resolutions: (m as { supported_resolutions?: string[] }).supported_resolutions })),
    video: videoRows.map((m) => {
      const pps = perSecond(m.pricing_skus)
      return { id: m.id, name: m.name || m.id, vendor: vendorOf(m.id), durations: m.supported_durations || [5], resolutions: m.supported_resolutions || ['720p'], aspects: m.supported_aspect_ratios || ['16:9', '9:16', '1:1'], audio: (m.allowed_passthrough_parameters || []).includes('generate_audio') || /veo|seedance|sora|wan|hailuo|grok/i.test(m.id), pricePerSecond: pps ? creditsFor(pps) : undefined, imageInput: true }
    }),
    tts: TTS,
    stt: STT,
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
      ...c.chat.map((m) => ({ id: m.id, name: m.name, context_length: m.context, architecture: { input_modalities: m.input, output_modalities: m.image ? ['text', 'image'] : ['text'] } })),
      ...c.image.filter((m) => !c.chat.some((x) => x.id === m.id)).map((m) => ({ id: m.id, name: m.name, architecture: { output_modalities: ['image'] } })),
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

export async function speech(c: Caller, body: Record<string, unknown>): Promise<Response> {
  requireCredits(c.profile, 1)
  const up = await orFetch('/audio/speech', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const buf = new Uint8Array(await up.arrayBuffer())
  const genId = up.headers.get('x-generation-id') || ''
  const cost = genId ? await costOf(genId) : 0
  await charge(c, cost, String(body.model || ''), 'Voice', genId)
  return new Response(buf, { headers: { 'Content-Type': up.headers.get('content-type') || 'audio/mpeg' } })
}

export async function transcribe(c: Caller, body: Record<string, unknown>) {
  requireCredits(c.profile, 1)
  const up = await orFetch('/audio/transcriptions', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const genId = up.headers.get('x-generation-id') || ''
  const j = (await up.json()) as { text?: string; usage?: { cost?: number } }
  let cost = j.usage?.cost
  if (cost === undefined && genId) cost = await costOf(genId)
  await charge(c, cost || 0, String(body.model || ''), 'Dictation', genId)
  return j
}
