// The gateway to OpenRouter: chat, images, video, speech and transcription.
// The OpenRouter key never leaves this server. Every call is metered with the cost OpenRouter reports
// (usage.cost, or the generation lookup) and charged to the user as credits with the markup.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config, chargeFor, creditsFor } from './config.ts'
import { db } from './db.ts'
import { debit, HttpError, requireCredits } from './accounts.ts'
import type { User } from './db.ts'

const headers = (json = true): Record<string, string> => ({
  Authorization: `Bearer ${config.openrouterKey}`,
  'HTTP-Referer': config.appUrl,
  'X-Title': config.appName,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})

function ensureKey() {
  if (!config.openrouterKey) throw new HttpError(503, 'Orbi Cloud is not configured yet (missing OpenRouter key on the server).', 'not_configured')
}

async function orFetch(path: string, init: RequestInit = {}) {
  ensureKey()
  return fetch(`${config.openrouterBase}${path}`, { ...init, headers: { ...headers(init.body !== undefined && typeof init.body === 'string'), ...(init.headers as Record<string, string> | undefined) } })
}

async function orError(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  let msg = text
  try {
    const j = JSON.parse(text)
    msg = j.error?.message || j.message || text
  } catch {
    /* keep text */
  }
  throw new HttpError(res.status === 401 || res.status === 403 ? 502 : res.status, msg || `OpenRouter error ${res.status}`, 'upstream')
}

/** Looks up the final cost of a generation when the response did not carry it. */
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

function charge(u: User, costUsd: number, model: string, note: string, ref = '') {
  debit(u.id, chargeFor(costUsd), costUsd, model, note, ref)
}

// ---------------------------------------------------------------- catalog

type OrModel = {
  id: string
  name: string
  created?: number
  context_length?: number
  description?: string
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  pricing?: Record<string, string | number>
}
const VENDORS = ['openai', 'anthropic', 'google', 'x-ai', 'deepseek', 'meta-llama', 'mistralai', 'qwen', 'moonshotai', 'z-ai', 'minimax', 'perplexity', 'cohere', 'amazon', 'microsoft', 'nvidia']
let cache: { at: number; data: Catalog } | null = null

export type Catalog = {
  chat: { id: string; name: string; vendor: string; context: number; input: string[]; image: boolean; price: { in: number; out: number } }[]
  image: { id: string; name: string; vendor: string; price?: number; aspects?: string[]; resolutions?: string[] }[]
  video: { id: string; name: string; vendor: string; durations: number[]; resolutions: string[]; aspects: string[]; audio: boolean; pricePerSecond?: number; imageInput: boolean }[]
  tts: { id: string; name: string; voices: string[] }[]
  stt: { id: string; name: string }[]
  credits: { usd: number; markup: number }
}

const TTS = [
  { id: 'openai/gpt-4o-mini-tts-2025-12-15', name: 'OpenAI GPT-4o mini TTS', voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] },
  { id: 'google/gemini-3.1-flash-tts-preview', name: 'Google Gemini 3.1 Flash TTS', voices: ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Aoede', 'Orus'] },
  { id: 'mistralai/voxtral-mini-tts-2603', name: 'Mistral Voxtral Mini TTS', voices: [] },
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
    const j = (await r.json()) as { data?: T[] }
    return j.data || []
  } catch {
    return []
  }
}

export async function catalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < 30 * 60000) return cache.data
  const all = await listJson<OrModel>('/models')
  let chat = all.filter((m) => (m.architecture?.output_modalities || ['text']).includes('text') && !isFree(m))
  if (config.chatModels.length) chat = config.chatModels.map((id) => chat.find((m) => m.id === id)).filter((m): m is OrModel => !!m)
  else {
    // The newest models of the main vendors, a handful each.
    const per = new Map<string, number>()
    chat = chat
      .filter((m) => VENDORS.includes(vendorOf(m.id)))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .filter((m) => {
        const v = vendorOf(m.id)
        const n = per.get(v) || 0
        per.set(v, n + 1)
        return n < 8
      })
  }
  const imageRows = await listJson<OrModel & { pricing?: Record<string, unknown>; supported_aspect_ratios?: string[]; supported_resolutions?: string[] }>('/images/models')
  const imgFallback = imageRows.length ? [] : all.filter((m) => (m.architecture?.output_modalities || []).includes('image') && !m.id.endsWith(':free'))
  const videoRows = await listJson<{
    id: string
    name?: string
    supported_durations?: number[]
    supported_resolutions?: string[]
    supported_aspect_ratios?: string[]
    pricing_skus?: { price?: number | string; unit?: string; per?: string }[] | Record<string, unknown>
    allowed_passthrough_parameters?: string[]
    description?: string
  }>('/videos/models')

  const perSecond = (skus: unknown): number | undefined => {
    const list = Array.isArray(skus) ? skus : skus && typeof skus === 'object' ? Object.values(skus as object) : []
    const prices = list
      .map((s) => (typeof s === 'object' && s ? num((s as { price?: unknown; amount?: unknown }).price ?? (s as { amount?: unknown }).amount) : num(s)))
      .filter((p) => p > 0)
    return prices.length ? Math.min(...prices) : undefined
  }

  const data: Catalog = {
    chat: chat.map((m) => ({
      id: m.id,
      name: m.name,
      vendor: vendorOf(m.id),
      context: m.context_length || 0,
      input: m.architecture?.input_modalities || ['text'],
      image: (m.architecture?.output_modalities || []).includes('image'),
      // credits per 1M tokens
      price: { in: creditsFor(num(m.pricing?.prompt) * 1e6), out: creditsFor(num(m.pricing?.completion) * 1e6) },
    })),
    image: (imageRows.length ? imageRows : imgFallback).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      vendor: vendorOf(m.id),
      price: num((m.pricing as Record<string, unknown> | undefined)?.image) ? creditsFor(num((m.pricing as Record<string, unknown>).image)) : undefined,
      aspects: (m as { supported_aspect_ratios?: string[] }).supported_aspect_ratios,
      resolutions: (m as { supported_resolutions?: string[] }).supported_resolutions,
    })),
    video: videoRows.map((m) => {
      const pps = perSecond(m.pricing_skus)
      return {
        id: m.id,
        name: m.name || m.id,
        vendor: vendorOf(m.id),
        durations: m.supported_durations || [5],
        resolutions: m.supported_resolutions || ['720p'],
        aspects: m.supported_aspect_ratios || ['16:9', '9:16', '1:1'],
        audio: (m.allowed_passthrough_parameters || []).includes('generate_audio') || /veo|seedance|sora|wan|hailuo|grok/i.test(m.id),
        pricePerSecond: pps ? creditsFor(pps) : undefined,
        imageInput: true,
      }
    }),
    tts: TTS,
    stt: STT,
    credits: { usd: config.creditUsd, markup: config.markup },
  }
  if (all.length) cache = { at: Date.now(), data }
  return data
}

/** OpenAI-style model list for the desktop chat picker: chat models plus image models flagged by output modality. */
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

export async function chat(u: User, body: Record<string, unknown>, res: ServerResponse) {
  requireCredits(u, 1)
  const model = String(body.model || '')
  if (!model || model.endsWith(':free')) throw new HttpError(400, 'Pick a model.', 'bad_model')
  const payload = { ...body, user: u.id, usage: { include: true }, ...(body.stream ? { stream_options: { include_usage: true } } : {}) }
  const up = await orFetch('/chat/completions', { method: 'POST', body: JSON.stringify(payload) })
  if (!up.ok) await orError(up)
  let cost: number | undefined
  let genId = ''
  if (!body.stream) {
    const j = (await up.json()) as { id?: string; usage?: { cost?: number } }
    cost = j.usage?.cost
    genId = j.id || ''
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(j))
  } else {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const reader = up.body!.getReader()
    const dec = new TextDecoder()
    let tail = ''
    let aborted = false
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true
        reader.cancel().catch(() => {})
      }
    })
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
        tail += dec.decode(value, { stream: true })
        const lines = tail.split('\n')
        tail = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:') || line.includes('[DONE]')) continue
          try {
            const j = JSON.parse(line.slice(5))
            if (j.id && !genId) genId = j.id
            if (typeof j.usage?.cost === 'number') cost = j.usage.cost
          } catch {
            /* partial or keep-alive */
          }
        }
      }
    } catch {
      aborted = true
    }
    if (!res.writableEnded) res.end()
    if (aborted && cost === undefined && !genId) return
  }
  if (cost === undefined && genId) cost = await costOf(genId)
  charge(u, cost || 0, model, 'Chat', genId)
}

// ---------------------------------------------------------------- images

export async function image(u: User, body: Record<string, unknown>) {
  requireCredits(u, 20)
  const model = String(body.model || '')
  const up = await orFetch('/images', { method: 'POST', body: JSON.stringify({ ...body, user: u.id }) })
  if (!up.ok) await orError(up)
  const j = (await up.json()) as { id?: string; usage?: { cost?: number }; data?: unknown[] }
  let cost = j.usage?.cost
  if (cost === undefined && j.id) cost = await costOf(j.id)
  charge(u, cost || 0, model, 'Image', j.id || '')
  return j
}

// ---------------------------------------------------------------- video (async jobs)

type VideoStatus = { id: string; status: string; generation_id?: string; usage?: { cost?: number }; error?: unknown; unsigned_urls?: string[]; urls?: string[]; polling_url?: string }
const publicJob = (j: VideoStatus) => ({
  id: j.id,
  status: j.status,
  error: j.error,
  outputs: (j.unsigned_urls || j.urls || []).map((_, i) => `${config.publicUrl}/v1/videos/${encodeURIComponent(j.id)}/content?index=${i}`),
})

export async function videoSubmit(u: User, body: Record<string, unknown>) {
  const c = await catalog()
  const model = String(body.model || '')
  const m = c.video.find((x) => x.id === model)
  const seconds = Number(body.duration || m?.durations?.[0] || 5)
  // Hold back enough credits for the whole clip before starting (videos are the expensive part).
  requireCredits(u, m?.pricePerSecond ? Math.ceil(m.pricePerSecond * seconds) : 300)
  const up = await orFetch('/videos', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const j = (await up.json()) as VideoStatus
  db.prepare('INSERT INTO video_jobs (id, user_id, model, created_at, status) VALUES (?,?,?,?,?)').run(j.id, u.id, model, Date.now(), j.status || 'pending')
  return publicJob(j)
}

function ownJob(u: User, id: string) {
  const row = db.prepare('SELECT * FROM video_jobs WHERE id = ? AND user_id = ?').get(id, u.id) as { id: string; model: string; charged: number } | undefined
  if (!row) throw new HttpError(404, 'Video not found.', 'not_found')
  return row
}

export async function videoStatus(u: User, id: string) {
  const row = ownJob(u, id)
  const up = await orFetch(`/videos/${encodeURIComponent(id)}`)
  if (!up.ok) await orError(up)
  const j = (await up.json()) as VideoStatus
  db.prepare('UPDATE video_jobs SET status = ? WHERE id = ?').run(j.status, id)
  if ((j.status === 'completed' || j.status === 'failed') && !row.charged) {
    // Charge once; a failed job is charged only if OpenRouter billed it.
    const claimed = db.prepare('UPDATE video_jobs SET charged = 1 WHERE id = ? AND charged = 0').run(id)
    if (Number(claimed.changes) > 0) {
      let cost = j.usage?.cost
      if (cost === undefined && j.status === 'completed' && j.generation_id) cost = await costOf(j.generation_id)
      charge(u, cost || 0, row.model, 'Video', id)
    }
  }
  return publicJob(j)
}

export async function videoContent(u: User, id: string, index: number, res: ServerResponse) {
  ownJob(u, id)
  const up = await orFetch(`/videos/${encodeURIComponent(id)}/content?index=${index}`)
  if (!up.ok) await orError(up)
  res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'video/mp4' })
  const reader = up.body!.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}

// ---------------------------------------------------------------- audio

export async function speech(u: User, body: Record<string, unknown>, res: ServerResponse) {
  requireCredits(u, 1)
  const up = await orFetch('/audio/speech', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const buf = Buffer.from(await up.arrayBuffer())
  res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'audio/mpeg' })
  res.end(buf)
  const genId = up.headers.get('x-generation-id') || ''
  const cost = genId ? await costOf(genId) : 0
  charge(u, cost, String(body.model || ''), 'Voice', genId)
}

export async function transcribe(u: User, body: Record<string, unknown>) {
  requireCredits(u, 1)
  const up = await orFetch('/audio/transcriptions', { method: 'POST', body: JSON.stringify(body) })
  if (!up.ok) await orError(up)
  const genId = up.headers.get('x-generation-id') || ''
  const j = (await up.json()) as { text?: string; usage?: { cost?: number } }
  let cost = j.usage?.cost
  if (cost === undefined && genId) cost = await costOf(genId)
  charge(u, cost || 0, String(body.model || ''), 'Dictation', genId)
  return j
}

export type { IncomingMessage }
