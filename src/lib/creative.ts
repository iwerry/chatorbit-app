// Shared by the Creative studio and the chat composer: which image/video models exist, sizes and aspect ratios.
import type { GenInfo, LocalStatus, ModelInfo } from './api'
import { t } from './i18n'

export type CreativeMode = 'image' | 'video'
export type CreativeOption = { key: string; label: string; group: string; kind: CreativeMode; local: boolean; providerId?: string; modelId: string; gen?: GenInfo | null; isNew?: boolean }

export const ASPECTS = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:3', w: 4, h: 3 },
  { id: '3:4', w: 3, h: 4 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '21:9', w: 21, h: 9 },
]
export const CLOUD_GEN: GenInfo = { presets: [0, 0, 0], fixedSteps: true, width: 1024, height: 1024, fps: 0, image: false, ref: false, end: false }
export const snap = (n: number) => Math.max(256, Math.round(n / 64) * 64)

export function creativeOptions(localStatus: LocalStatus | null, models: ModelInfo[]): CreativeOption[] {
  const out: CreativeOption[] = []
  for (const m of localStatus?.models ?? []) {
    if ((m.kind === 'image' || m.kind === 'video') && m.installed) out.push({ key: `local::${m.id}`, label: m.name, group: t('On this PC'), kind: m.kind, local: true, modelId: m.id, gen: m.gen, isNew: m.isNew })
  }
  for (const m of models.filter((x) => x.image)) out.push({ key: `cloud::${m.key}`, label: m.name, group: m.providerName, kind: 'image', local: false, providerId: m.provider, modelId: m.id, gen: CLOUD_GEN })
  return out
}

/** Resolutions offered for a model, by short side. Never more than about 1.5× what the model was trained for. */
export function resolutionsFor(o: CreativeOption | undefined, mode: CreativeMode): number[] {
  const native = Math.min(o?.gen?.width || 1024, o?.gen?.height || 1024)
  const list = mode === 'video' ? [320, 480, 720, 1080] : [512, 768, 1024, 1536]
  const ok = list.filter((r) => r <= native * 1.5)
  return ok.length ? ok : [list[0]]
}

/** Width and height for an aspect ratio and short side, snapped to 64 px. */
export function sizeFor(aspect: string, short: number) {
  const a = ASPECTS.find((x) => x.id === aspect) ?? ASPECTS[0]
  const k = short / Math.min(a.w, a.h)
  return { w: snap(a.w * k), h: snap(a.h * k) }
}

export const resLabel = (r: number) => `${r}p`
