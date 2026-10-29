// Shared by the Creative studio and the chat composer: which image/video models exist, sizes and aspect ratios.
import type { CloudCatalog, GenInfo, LocalStatus, ModelInfo } from './api'
import { CLOUD_ONLY, vendorLabel } from './cloud'
import { t } from './i18n'

export type CreativeMode = 'image' | 'video'
export type CloudVideoSpec = { durations: number[]; resolutions: string[]; aspects: string[]; audio: boolean; pricePerSecond?: number; usdBySecond?: Record<string, number> }
export type CreativeOption = { key: string; label: string; group: string; kind: CreativeMode; local: boolean; providerId?: string; modelId: string; gen?: GenInfo | null; isNew?: boolean; video?: CloudVideoSpec; price?: number; usd?: number; featured?: boolean; aspects?: string[]; resolutions?: string[] }

/** The aspect ratios offered when a model does not list its own (models on this PC). */
export const ASPECTS = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:3', w: 4, h: 3 },
  { id: '3:4', w: 3, h: 4 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '21:9', w: 21, h: 9 },
]

/** Width and height parts of "16:9" (any "a:b", also "19.5:9"). */
export function ratio(id: string): { w: number; h: number } {
  const [w, h] = String(id).split(':').map(Number)
  return w > 0 && h > 0 ? { w, h } : { w: 1, h: 1 }
}

// What each aspect ratio is for, in the order people look for them (square, portrait, landscape, wide).
const ASPECT_INFO: Record<string, { name: string; use: string; px: string }> = {
  '1:1': { name: 'Square', use: 'Feed posts', px: '1080 × 1080' },
  '4:5': { name: 'Portrait', use: 'Instagram feed', px: '1080 × 1350' },
  '3:4': { name: 'Portrait', use: 'Vertical feed posts', px: '1080 × 1440' },
  '2:3': { name: 'Portrait', use: 'Posters, Pinterest, photo prints', px: '1024 × 1536' },
  '9:16': { name: 'Tall vertical', use: 'Reels, TikTok and Shorts', px: '1080 × 1920' },
  '9:19.5': { name: 'Phone screen', use: 'Wallpapers, full-screen stories', px: '1080 × 2340' },
  '9:20': { name: 'Phone screen', use: 'Wallpapers, full-screen stories', px: '1080 × 2400' },
  '9:21': { name: 'Very tall', use: 'Phone wallpapers, scrolling stories', px: '1080 × 2520' },
  '1:2': { name: 'Tall', use: 'Banners and long stories', px: '1024 × 2048' },
  '1:4': { name: 'Very tall', use: 'Skyscraper banners', px: '512 × 2048' },
  '1:8': { name: 'Extra tall', use: 'Side banners', px: '256 × 2048' },
  '5:7': { name: 'Portrait', use: 'Cards and book covers', px: '1000 × 1400' },
  '5:4': { name: 'Landscape', use: 'Classic photo prints', px: '1350 × 1080' },
  '4:3': { name: 'Compact landscape', use: 'Old videos, retro look', px: '1440 × 1080' },
  '7:5': { name: 'Landscape', use: 'Photo prints', px: '1400 × 1000' },
  '3:2': { name: 'Landscape', use: 'Camera photos (35 mm)', px: '1536 × 1024' },
  '16:9': { name: 'Widescreen', use: 'YouTube, classes, interviews, TV', px: '1920 × 1080' },
  '2:1': { name: 'Wide', use: 'Headers and banners', px: '2048 × 1024' },
  '19.5:9': { name: 'Phone landscape', use: 'Full-screen phone, horizontal', px: '2340 × 1080' },
  '20:9': { name: 'Phone landscape', use: 'Full-screen phone, horizontal', px: '2400 × 1080' },
  '21:9': { name: 'Ultra-wide', use: 'Cinematic look (≈ 2.33:1)', px: '2520 × 1080' },
  '4:1': { name: 'Panorama', use: 'Website banners', px: '2048 × 512' },
  '8:1': { name: 'Extra wide', use: 'Thin banners', px: '2048 × 256' },
}
export const aspectInfo = (id: string) => ASPECT_INFO[id] || { name: id, use: '', px: '' }
const ASPECT_ORDER = Object.keys(ASPECT_INFO)

/** The aspect ratios this model accepts, in a friendly order. Models without a list get the common ones. */
export function aspectsFor(o: CreativeOption | undefined): string[] {
  const list = (o?.video?.aspects ?? o?.aspects ?? []).filter((a) => a !== 'auto' && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(a))
  if (!list.length) return ASPECTS.map((a) => a.id)
  return [...new Set(list)].sort((a, b) => (ASPECT_ORDER.indexOf(a) + 1 || 99) - (ASPECT_ORDER.indexOf(b) + 1 || 99))
}
/** The closest ratio a model accepts (so switching models keeps the picture shape). */
export function nearestAspect(list: string[], id: string) {
  if (list.includes(id)) return id
  const want = Math.log(ratio(id).w / ratio(id).h)
  return list.reduce((best, a) => (Math.abs(Math.log(ratio(a).w / ratio(a).h) - want) < Math.abs(Math.log(ratio(best).w / ratio(best).h) - want) ? a : best), list[0] || '1:1')
}
export const CLOUD_GEN: GenInfo = { presets: [0, 0, 0], fixedSteps: true, width: 1024, height: 1024, fps: 0, image: false, ref: false, end: false }
export const snap = (n: number) => Math.max(256, Math.round(n / 64) * 64)

// Popular models come first in their own group; the rest are grouped by maker.
const groupFor = (vendor: string, featured?: boolean) => (featured ? t('Popular') : vendorLabel(vendor))

export function creativeOptions(localStatus: LocalStatus | null, models: ModelInfo[], catalog?: CloudCatalog | null): CreativeOption[] {
  const out: CreativeOption[] = []
  if (CLOUD_ONLY) {
    const order = new Map((catalog?.image ?? []).map((m, i) => [m.id, i]))
    const images = models.filter((x) => x.image).sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6))
    for (const m of images) {
      const c = catalog?.image.find((x) => x.id === m.id)
      out.push({ key: `cloud::${m.key}`, label: m.name.replace(/^[^:]+:\s*/, ''), group: groupFor(m.id.split('/')[0], c?.featured), kind: 'image', local: false, providerId: m.provider, modelId: m.id, gen: CLOUD_GEN, price: c?.price, usd: c?.usd, featured: c?.featured, aspects: c?.aspects, resolutions: c?.resolutions })
    }
    for (const v of catalog?.video ?? [])
      out.push({ key: `cloudvideo::${v.id}`, label: v.name.replace(/^[^:]+:\s*/, ''), group: groupFor(v.vendor, v.featured), kind: 'video', local: false, providerId: 'orbicloud', modelId: v.id, gen: CLOUD_GEN, usd: v.usdPerSecond, featured: v.featured, video: { durations: v.durations, resolutions: v.resolutions, aspects: v.aspects, audio: v.audio, pricePerSecond: v.pricePerSecond, usdBySecond: v.usdBySecond } })
    return out
  }
  for (const m of localStatus?.models ?? []) {
    if ((m.kind === 'image' || m.kind === 'video') && m.installed) out.push({ key: `local::${m.id}`, label: m.name, group: t('On this PC'), kind: m.kind, local: true, modelId: m.id, gen: m.gen, isNew: m.isNew })
  }
  for (const m of models.filter((x) => x.image)) out.push({ key: `cloud::${m.key}`, label: m.name, group: m.providerName, kind: 'image', local: false, providerId: m.provider, modelId: m.id, gen: CLOUD_GEN })
  return out
}

/** Resolutions offered for a model, by short side. Never more than about 1.5× what the model was trained for. */
export function resolutionsFor(o: CreativeOption | undefined, mode: CreativeMode): number[] {
  if (o?.video) {
    const px = o.video.resolutions.map((r) => (/^(\d+)p$/i.test(r) ? Number(r.slice(0, -1)) : /^(\d)K$/i.test(r) ? Number(r[0]) * 1080 : 0)).filter(Boolean)
    if (px.length) return [...new Set(px)].sort((a, b) => a - b)
  }
  if (o && !o.local && mode === 'image') {
    // Image models list "1K", "2K", "4K"…: short side in pixels.
    const px = (o.resolutions ?? []).map((r) => (/^(\d+(\.\d+)?)K$/i.test(r) ? Math.round(parseFloat(r) * 1024) : /^\d+$/.test(r) ? Number(r) : 0)).filter(Boolean)
    return px.length ? [...new Set(px)].sort((a, b) => a - b) : [1024, 2048]
  }
  const native = Math.min(o?.gen?.width || 1024, o?.gen?.height || 1024)
  const list = mode === 'video' ? [320, 480, 720, 1080] : [512, 768, 1024, 1536]
  const ok = list.filter((r) => r <= native * 1.5)
  return ok.length ? ok : [list[0]]
}

/** Width and height for an aspect ratio and short side, snapped to 64 px. */
export function sizeFor(aspect: string, short: number) {
  const a = ratio(aspect)
  const k = short / Math.min(a.w, a.h)
  return { w: snap(a.w * k), h: snap(a.h * k) }
}

/** OpenRouter US$ for one run: images × count, or video seconds at the chosen resolution. */
export function estimateUsd(o: CreativeOption | undefined, p: { count?: number; seconds?: number; res?: number }) {
  if (!o || o.local) return undefined
  if (o.kind === 'video') {
    const label = p.res ? `${p.res}p` : '720p'
    const perSec = o.video?.usdBySecond?.[label] ?? o.usd
    return perSec !== undefined ? perSec * (p.seconds || o.video?.durations[0] || 5) : undefined
  }
  return o.usd !== undefined ? o.usd * (p.count || 1) : undefined
}

export const resLabel = (r: number) => (r === 1024 || r === 2048 || r === 4096 ? `${r / 1024}K` : r === 1536 ? '1.5K' : `${r}p`)
/** Resolution value an image model expects ("1K", "1.5K", "512"…). */
export const imageResValue = (r: number) => (r % 1024 === 0 || r === 1536 ? resLabel(r) : String(r))
