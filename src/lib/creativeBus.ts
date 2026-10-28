// Lets other screens (chat, Media Library) ask the Creative studio to render.
// Creative owns the render queue, so a render asked in the chat shows in Creative's queue and lands in the library,
// and the chat follows its progress through these updates.
import type { MediaItem } from './api'

export type GenRequest = {
  id: string
  mode: 'image' | 'video' | 'upscale'
  prompt: string
  negative?: string
  modelKey?: string
  aspect?: string
  /** Short side in pixels. */
  res?: number
  /** Video length in seconds. */
  duration?: number
  count?: number
  /** Start from this library image (image-to-video, edits, upscale). */
  initMediaId?: string
  /** Or an image attached in the chat. */
  initDataUrl?: string
  source?: 'chat' | 'library' | 'creative'
}
export type GenUpdate = {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  /** 0..1 over all results of the request. */
  progress?: number
  media?: MediaItem[]
  error?: string
  total?: number
}

const pending: GenRequest[] = []
let handler: ((r: GenRequest) => void) | null = null
const updates = new Set<(u: GenUpdate) => void>()
const last = new Map<string, GenUpdate>()

export const creativeBus = {
  request(r: GenRequest) {
    last.set(r.id, { id: r.id, status: 'queued', progress: 0, media: [], total: r.mode === 'video' || r.mode === 'upscale' ? 1 : r.count || 1 })
    updates.forEach((f) => f(last.get(r.id)!))
    if (handler) handler(r)
    else pending.push(r)
  },
  /** Creative registers itself here when it mounts; requests made before that are delivered now. */
  serve(fn: (r: GenRequest) => void) {
    handler = fn
    while (pending.length) fn(pending.shift()!)
    return () => {
      if (handler === fn) handler = null
    }
  },
  emit(u: Partial<GenUpdate> & { id: string }) {
    const prev = last.get(u.id) ?? { id: u.id, status: 'queued' as const, media: [] }
    const next: GenUpdate = { ...prev, ...u, media: u.media ? [...(prev.media ?? []), ...u.media.filter((m) => !(prev.media ?? []).some((x) => x.id === m.id))] : prev.media }
    last.set(u.id, next)
    updates.forEach((f) => f(next))
  },
  state: (id: string) => last.get(id),
  subscribe(fn: (u: GenUpdate) => void) {
    updates.add(fn)
    return () => {
      updates.delete(fn)
    }
  },
}

/** Opens something in the Creative canvas (prompt, mode, start image). Kept until Creative is mounted to read it. */
export type UseDetail = { prompt: string; negative?: string; mode?: 'image' | 'video'; initMediaId?: string }
let pendingUse: UseDetail | null = null
export function openInCreative(d: UseDetail) {
  pendingUse = d
  window.dispatchEvent(new CustomEvent('orbi:use-prompt', { detail: d }))
}
export function takePendingUse() {
  const d = pendingUse
  pendingUse = null
  return d
}

/** Marker stored in an assistant message that holds media made from the chat. */
export type ChatMediaMeta = { req: string; mode: 'image' | 'video' | 'upscale'; model: string; prompt: string; ids: string[]; count: number; aspect?: string; error?: string }
const MARK = /^<!--orbi-media (\{[\s\S]*?\})-->/
export const encodeChatMedia = (m: ChatMediaMeta) => `<!--orbi-media ${JSON.stringify(m)}-->`
export function decodeChatMedia(content: string): ChatMediaMeta | null {
  const m = content.match(MARK)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as ChatMediaMeta
  } catch {
    return null
  }
}
