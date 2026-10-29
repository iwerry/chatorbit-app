// Turns model lists into ModelMenu items (name, company group, price, Popular).
import type { CloudCatalog, ModelInfo } from './api'
import type { CreativeOption } from './creative'
import { CLOUD_ONLY, vendorLabel } from './cloud'
import { t } from './i18n'
import type { MenuItem } from '../components/ModelMenu'

const short = (name: string) => name.replace(/^[^:]+:\s*/, '')

/** Image and video models (Creative options). */
export const creativeItems = (list: CreativeOption[]): MenuItem[] =>
  list.map((o) => ({ key: o.key, name: o.label, sub: o.local ? t('Runs on this PC') : o.modelId, group: o.group, featured: o.featured, usd: o.usd, unit: o.kind === 'video' ? 's' : 'img' }))

/** Chat models, Popular first, then by company. `keyOf` maps a model to the value the caller stores. */
export function chatItems(models: ModelInfo[], catalog: CloudCatalog | null, keyOf: (m: ModelInfo) => string = (m) => m.key): MenuItem[] {
  const info = new Map((catalog?.chat ?? []).map((m, i) => [m.id, { ...m, i }]))
  const list = [...models].sort((a, b) => (info.get(a.id)?.i ?? 1e6) - (info.get(b.id)?.i ?? 1e6))
  const item = (m: ModelInfo, group: string): MenuItem => {
    const c = info.get(m.id)
    return { key: keyOf(m), name: short(m.name), sub: m.id, group, featured: c?.featured, usd: c?.usd?.in, usdOut: c?.usd?.out, unit: 'M' }
  }
  if (!CLOUD_ONLY) return list.map((m) => item(m, m.providerName))
  return list.map((m) => item(m, info.get(m.id)?.featured ? t('Popular') : vendorLabel(m.id.split('/')[0])))
}

/** Voice (text-to-speech) or dictation models from the catalog. */
export const audioItems = (list: { id: string; name: string; vendor?: string; usd?: number }[], unit: 'k' | 'min'): MenuItem[] =>
  list.map((m, i) => ({ key: m.id, name: short(m.name), sub: m.id, group: i < 3 ? t('Popular') : vendorLabel(m.vendor || m.id.split('/')[0]), featured: i < 3, usd: m.usd, unit }))
