// Orbi Cloud on the front end: the account state shared by every screen, and the model catalog.
import { useEffect, useState } from 'react'
import { api, type CloudCatalog, type CloudState } from './api'

/** Orbi runs on Orbi Cloud: market models, no personal API keys, no local engines in the interface. */
export const CLOUD_ONLY = true

let state: CloudState | null = null
let catalog: CloudCatalog | null = null
let loading: Promise<void> | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export async function refreshCloud() {
  state = await api.cloudState().catch((e) => ({ url: '', signedIn: false, user: null, payments: false, error: String(e?.message || e), code: 'offline' }))
  if (state.signedIn && state.user) catalog = await api.cloudCatalog().catch(() => catalog)
  emit()
  return state
}

/** Account state and catalog; refreshes every minute while a screen uses it. */
export function useCloud() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    subs.add(f)
    if (!state && !loading) loading = refreshCloud().then(() => void (loading = null))
    const tm = setInterval(() => document.visibilityState === 'visible' && refreshCloud(), 60000)
    return () => {
      subs.delete(f)
      clearInterval(tm)
    }
  }, [])
  return { state, catalog, refresh: refreshCloud }
}

/** How people know each AI maker: the product name first (ChatGPT, Claude, Gemini, Kimi…). */
const VENDOR_LABELS: Record<string, string> = {
  openai: 'ChatGPT · OpenAI',
  anthropic: 'Claude · Anthropic',
  google: 'Gemini · Google',
  deepseek: 'DeepSeek',
  moonshotai: 'Kimi · Moonshot',
  'x-ai': 'Grok · xAI',
  qwen: 'Qwen · Alibaba',
  'meta-llama': 'Llama · Meta',
  mistralai: 'Mistral',
  'z-ai': 'GLM · Z.ai',
  minimax: 'MiniMax',
  perplexity: 'Perplexity',
  cohere: 'Cohere',
  amazon: 'Nova · Amazon',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA',
  'black-forest-labs': 'FLUX · Black Forest Labs',
  bytedance: 'ByteDance',
  'bytedance-seed': 'ByteDance',
  alibaba: 'Alibaba',
  kwaivgi: 'Kling',
  recraft: 'Recraft',
  ideogram: 'Ideogram',
  heygen: 'HeyGen',
}
export const vendorLabel = (vendor: string) => VENDOR_LABELS[vendor] || vendor.charAt(0).toUpperCase() + vendor.slice(1)

// ---------- prices and quick tags ----------
// Admins see OpenRouter's own price in US$; everyone else sees what it costs in credits.
type Unit = 'M' | 'img' | 's' | 'k' | 'min'
const UNIT_LABEL: Record<Unit, string> = { M: '/M', img: '/img', s: '/s', k: '/1k', min: '/min' }
function money(usd: number) {
  if (usd >= 10) return `$${usd.toFixed(0)}`
  if (usd >= 1) return `$${usd.toFixed(2).replace(/\.00$/, '')}`
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  return `$${usd.toPrecision(2)}`
}
export function priceLabel(usd: number | undefined, unit: Unit, admin: boolean, c?: CloudCatalog | null, usdOut?: number) {
  if (usd === undefined || !Number.isFinite(usd) || (usd <= 0 && !usdOut)) return ''
  if (admin) return `${money(usd)}${usdOut !== undefined ? ` · ${money(usdOut)}` : ''}${UNIT_LABEL[unit]}`
  const cr = (u: number) => fmtCredits(Math.max(0.1, (u * (c?.credits.markup ?? 1.25)) / (c?.credits.usd ?? 0.001)))
  return `${cr(usd)}${usdOut !== undefined ? ` · ${cr(usdOut)}` : ''} cr${UNIT_LABEL[unit]}`
}
const FAST = /flash|fast|lite|mini|turbo|haiku|instant|klein|schnell|nano(?![\s-]?banana)|speed|small|std\b/i
/** "Fast", "Cheap" and "Top" chips for a list of models of the same kind (by price). */
export function modelTags(list: { id: string; name: string; featured?: boolean; cost?: number }[]) {
  const costs = list.map((m) => m.cost).filter((x): x is number => typeof x === 'number' && x > 0).sort((a, b) => a - b)
  const q = (p: number) => costs[Math.min(costs.length - 1, Math.floor(costs.length * p))]
  const cheap = costs.length > 3 ? q(0.3) : undefined
  const pricey = costs.length > 3 ? q(0.6) : undefined
  const out = new Map<string, string[]>()
  for (const m of list) {
    const tags: string[] = []
    if (m.featured && m.cost !== undefined && pricey !== undefined && m.cost >= pricey) tags.push('Top')
    if (FAST.test(`${m.id} ${m.name}`)) tags.push('Fast')
    if (m.cost !== undefined && cheap !== undefined && m.cost > 0 && m.cost <= cheap) tags.push('Cheap')
    out.set(m.id, tags)
  }
  return out
}

export const fmtCredits = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n)

/** "720p" style label closest to a short side in pixels, within what the model supports. */
export function nearestRes(list: string[], short: number) {
  const px = (r: string) => (/^(\d+)p$/i.test(r) ? Number(r.slice(0, -1)) : /^(\d)K$/i.test(r) ? Number(r[0]) * 1080 : 720)
  return list.reduce((a, b) => (Math.abs(px(b) - short) < Math.abs(px(a) - short) ? b : a), list[0])
}
export const nearestDuration = (list: number[], s: number) => (list.length ? list.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), list[0]) : s)
