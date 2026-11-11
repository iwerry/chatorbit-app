// Node workflows in the spirit of ComfyUI: typed ports, drag a wire from an output to an input,
// and every node really runs (text AI, image and video generation, voiceover, save to board).
import { CLOUD_ONLY, nearestDuration, nearestRes, refreshCloud, useCloud, vendorLabel } from '../lib/cloud'
import { aspectInfo, aspectsFor, nearestAspect, ratio, type CreativeOption } from '../lib/creative'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type PointerEvent as RPointerEvent } from 'react'
import { WorkflowTabs } from './WorkflowTabs'
import {
  AudioLines,
  Ban,
  Bot,
  Copy,
  Download,
  FileText,
  FolderInput,
  FileDown,
  FileUp,
  Image as ImageIcon,
  Maximize2,
  Paintbrush,
  WandSparkles,
  LayoutTemplate,
  Loader2,
  Maximize,
  Minus,
  Play,
  Plus,
  Search,
  Square,
  StickyNote,
  Trash2,
  Video,
  X,
  type LucideIcon,
  Film,
  Volume2,
  PenTool,
  Crop,
  Clapperboard,
  FastForward,
  FileAudio,
  Music,
  Waves,
  Upload,
  MousePointer2,
  Hand,
  PackagePlus,
  Type,
  Circle,
  Slash,
  MoveUpRight,
  RectangleHorizontal,
  Pencil,
  ImagePlus,
  Check,
} from 'lucide-react'
import { api, on, type Board, type CloudCatalog, type LocalStatus, type MediaItem, type ModelInfo, type TtsChoice } from '../lib/api'
import { CostChip, ModelSelect, type MenuItem } from './ModelMenu'
import { audioItems, chatItems } from '../lib/menuItems'
import { VoiceButton } from './VoiceLibrary'
import { getLang, t } from '../lib/i18n'
import { activity } from '../lib/activity'
import { importComfy } from '../lib/comfy'
import { DEFAULT_NEGATIVE } from '../lib/ideas'
import { PromptTools } from './PromptTools'
import { GENRES, INTENSITY, LANGUAGES, MOODS, SPACES, STYLES, VOCALS, musicPrompt, sampleCache, sampleText, sfxPrompt, withStyle, takesStyle, voiceName } from '../lib/audioPrompt'

// ---------- types ----------
type PortType = 'text' | 'image' | 'video' | 'audio' | 'media'
type Kind =
  | 'prompt'
  | 'negative'
  | 'llm'
  | 'image'
  | 'vector'
  | 'video'
  | 'extend'
  | 'load'
  | 'loadvideo'
  | 'loadaudio'
  | 'edit'
  | 'recompose'
  | 'inpaint'
  | 'upscale'
  | 'voice'
  | 'music'
  | 'sfx'
  | 'output'
  | 'note'
type Media = { id: string; url: string; name: string; kind: string }
type Val = { text?: string; media?: Media }
type FNode = {
  id: string
  kind: Kind
  x: number
  y: number
  data: Record<string, string | number | undefined>
  out?: Val
  status?: 'idle' | 'running' | 'done' | 'error'
  error?: string
  progress?: number
}
type FEdge = { id: string; from: string; fromPort: string; to: string; toPort: string }
// Free annotations on the canvas (Miro / Firefly Boards style), saved with the workflow.
type Tool = 'select' | 'hand' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen'
type Mark = { id: string; type: Exclude<Tool, 'select' | 'hand'>; x: number; y: number; w: number; h: number; pts?: number[]; color: string; size: number; text?: string }
const INKS = ['#e8eaed', '#e5484d', '#3e63dd', '#c2ef4e', '#f5a524']
const SIZES = [2, 4, 8]
type Port = { id: string; label: string; type: PortType; optional?: boolean }
type Def = { title: string; hint: string; icon: LucideIcon; color: string; group: string; inputs: Port[]; outputs: Port[]; data: () => FNode['data'] }

const DEFS: Record<Kind, Def> = {
  prompt: { title: 'Prompt', hint: 'Write the idea or brief', icon: FileText, color: '#9a7db0', group: 'Text', inputs: [], outputs: [{ id: 'text', label: 'Text', type: 'text' }], data: () => ({ text: '' }) },
  negative: {
    title: 'Negative prompt',
    hint: 'What the image or video should avoid',
    icon: Ban,
    color: '#c46a6a',
    group: 'Text',
    inputs: [],
    outputs: [{ id: 'text', label: 'Negative', type: 'text' }],
    data: () => ({ text: DEFAULT_NEGATIVE.image }),
  },
  llm: {
    title: 'Text AI',
    hint: 'Rewrites or expands text with a chat model',
    icon: Bot,
    color: '#b07db0',
    group: 'Text',
    inputs: [{ id: 'text', label: 'Text', type: 'text' }],
    outputs: [{ id: 'text', label: 'Text', type: 'text' }],
    data: () => ({ preset: 'image', instruction: '' }),
  },
  image: {
    title: 'Generate image',
    hint: 'Text (and an optional image) to image',
    icon: ImageIcon,
    color: '#5f9fd0',
    group: 'Image',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text' },
      { id: 'image', label: 'Start image', type: 'image', optional: true },
      { id: 'negative', label: 'Negative', type: 'text', optional: true },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    data: () => ({ aspect: '1:1', steps: 0, seed: '', strength: 0.65 }),
  },
  video: {
    title: 'Generate video',
    hint: 'Text or image to a short clip',
    icon: Video,
    color: '#4fbf9a',
    group: 'Video',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text' },
      { id: 'image', label: 'First frame', type: 'image', optional: true },
      { id: 'negative', label: 'Negative', type: 'text', optional: true },
    ],
    outputs: [{ id: 'video', label: 'Video', type: 'video' }],
    data: () => ({ frames: 33 }),
  },
  edit: {
    title: 'Edit image',
    hint: 'Change an image with words (FLUX Klein, Qwen or Mage-Flow Edit)',
    icon: WandSparkles,
    color: '#6f8fe0',
    group: 'Image',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'prompt', label: 'What to change', type: 'text' },
      { id: 'negative', label: 'Negative', type: 'text', optional: true },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    data: () => ({}),
  },
  inpaint: {
    title: 'Inpaint',
    hint: 'Repaint only the area you mask',
    icon: Paintbrush,
    color: '#d06fa0',
    group: 'Image',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'prompt', label: 'What to paint', type: 'text' },
      { id: 'negative', label: 'Negative', type: 'text', optional: true },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    data: () => ({ strength: 0.85 }),
  },
  upscale: {
    title: 'Upscale 4×',
    hint: 'Bigger and sharper (Real-ESRGAN)',
    icon: Maximize2,
    color: '#5fb0c0',
    group: 'Image',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    data: () => ({}),
  },
  load: { title: 'Load image', hint: 'From your library, or drop a file on the canvas', icon: FolderInput, color: '#7aa36b', group: 'Image', inputs: [], outputs: [{ id: 'image', label: 'Image', type: 'image' }], data: () => ({}) },
  vector: {
    title: 'Vector (SVG)',
    hint: 'Logos, icons and illustrations as editable vectors (Recraft)',
    icon: PenTool,
    color: '#8fb05f',
    group: 'Image',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text' },
      { id: 'image', label: 'Style reference', type: 'image', optional: true },
    ],
    outputs: [{ id: 'image', label: 'Vector', type: 'image' }],
    data: () => ({ aspect: '1:1' }),
  },
  recompose: {
    title: 'Recompose format',
    hint: 'Adapt a design to a new aspect ratio: extends the scene and re-lays out the elements',
    icon: Crop,
    color: '#7f86e0',
    group: 'Image',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'prompt', label: 'Extra direction', type: 'text', optional: true },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    data: () => ({ aspect: '16:9', resolution: '2K' }),
  },
  loadvideo: { title: 'Load video', hint: 'From your library, or drop a file on the canvas', icon: Clapperboard, color: '#5fae8c', group: 'Video', inputs: [], outputs: [{ id: 'video', label: 'Video', type: 'video' }], data: () => ({}) },
  extend: {
    title: 'Extend video',
    hint: 'Continues a clip: its last frame starts the new shot',
    icon: FastForward,
    color: '#45a98a',
    group: 'Video',
    inputs: [
      { id: 'video', label: 'Video', type: 'video' },
      { id: 'prompt', label: 'What happens next', type: 'text' },
      { id: 'negative', label: 'Negative', type: 'text', optional: true },
    ],
    outputs: [{ id: 'video', label: 'New shot', type: 'video' }],
    data: () => ({ duration: 5, aspect: '16:9' }),
  },
  loadaudio: { title: 'Load audio', hint: 'From your library, or drop a file on the canvas', icon: FileAudio, color: '#c9885a', group: 'Audio', inputs: [], outputs: [{ id: 'audio', label: 'Audio', type: 'audio' }], data: () => ({}) },
  music: {
    title: 'Music',
    hint: 'Songs and soundtracks with style, mood, vocals and lyrics (Lyria)',
    icon: Music,
    color: '#d0789a',
    group: 'Audio',
    inputs: [
      { id: 'prompt', label: 'Description', type: 'text', optional: true },
      { id: 'lyrics', label: 'Lyrics', type: 'text', optional: true },
    ],
    outputs: [{ id: 'audio', label: 'Music', type: 'audio' }],
    data: () => ({ genres: '', moods: '', bpm: 0, vocals: 'Instrumental', language: 'Any language', length: 0 }),
  },
  sfx: {
    title: 'Sound effect',
    hint: 'Any sound from a description (Seed Audio)',
    icon: Waves,
    color: '#c99a4b',
    group: 'Audio',
    inputs: [{ id: 'prompt', label: 'Sound', type: 'text' }],
    outputs: [{ id: 'audio', label: 'Sound', type: 'audio' }],
    data: () => ({ seconds: 5, intensity: 'Medium', space: '', loop: 0 }),
  },
  voice: {
    title: 'Voiceover',
    hint: 'Text to speech — offline voices or OpenAI',
    icon: AudioLines,
    color: '#e08a4b',
    group: 'Audio',
    inputs: [{ id: 'text', label: 'Script', type: 'text' }],
    outputs: [{ id: 'audio', label: 'Audio', type: 'audio' }],
    data: () => ({ voice: '' }),
  },
  output: {
    title: 'Save to board',
    hint: 'Collects results into a board',
    icon: Download,
    color: '#a5b84a',
    group: 'Output',
    inputs: [{ id: 'media', label: 'Image / video / audio', type: 'media' }],
    outputs: [],
    data: () => ({ board: '' }),
  },
  note: { title: 'Note', hint: 'A comment on the canvas', icon: StickyNote, color: '#c9b458', group: 'Other', inputs: [], outputs: [], data: () => ({ text: '' }) },
}

const PRESETS: Record<string, { label: string; system: string }> = {
  image: { label: 'Write an image prompt', system: 'Turn the user text into ONE vivid, detailed image-generation prompt in English: subject, setting, composition, lighting, lens, style. Reply with the prompt only.' },
  video: { label: 'Write a video prompt', system: 'Turn the user text into ONE short video-generation prompt in English describing subject, action, camera movement and mood in 2–3 sentences. Reply with the prompt only.' },
  script: { label: 'Write a voiceover script', system: 'Write a short, natural voiceover script (max 60 words) for the user brief, in the same language as the brief. Reply with the script only.' },
  custom: { label: 'Custom instruction', system: '' },
}
const ASPECTS: Record<string, [number, number]> = { '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '16:9': [16, 9], '9:16': [9, 16] }
const ratioOf = (id: string): [number, number] => {
  const r = ratio(id)
  return [r.w, r.h]
}
const VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']

// An infinite board: zoom far out to see everything, or in to read a node.
const ZOOM_MIN = 0.1
const ZOOM_MAX = 3
// Dot spacing on screen: far out, the grid steps up 4× instead of turning into noise.
const gridStep = (z: number) => {
  let s = 22 * z
  while (s < 11) s *= 4
  return s
}
const NODE_W = 280
const HEAD_H = 42
const PORT_H = 26
const portY = (i: number) => HEAD_H + 14 + i * PORT_H
const uidN = () => Math.random().toString(36).slice(2, 9)
const compatible = (from: PortType, to: PortType) => from === to || (to === 'media' && ['image', 'video', 'audio'].includes(from))
const cleanErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const snap64 = (n: number) => Math.max(256, Math.round(n / 64) * 64)

// ---------- templates ----------
function template(id: string): { nodes: FNode[]; edges: FEdge[] } {
  const n = (kind: Kind, x: number, y: number, data: FNode['data'] = {}): FNode => ({ id: uidN(), kind, x, y, data: { ...DEFS[kind].data(), ...data } })
  const e = (a: FNode, ap: string, b: FNode, bp: string): FEdge => ({ id: uidN(), from: a.id, fromPort: ap, to: b.id, toPort: bp })
  // Every generating template gets a Negative prompt node wired in (ComfyUI style).
  const neg = (x: number, y: number, video = false) => n('negative', x, y, { text: video ? DEFAULT_NEGATIVE.video : DEFAULT_NEGATIVE.image })
  if (id === 'text-image') {
    const p = n('prompt', 80, 100, { text: 'A cozy coffee shop on a rainy evening, warm light, cinematic' })
    const ng = neg(80, 330)
    const i = n('image', 430, 100)
    const o = n('output', 780, 140)
    return { nodes: [p, ng, i, o], edges: [e(p, 'text', i, 'prompt'), e(ng, 'text', i, 'negative'), e(i, 'image', o, 'media')] }
  }
  if (id === 'idea-image') {
    const p = n('prompt', 60, 160, { text: 'Poster for a jazz night in São Paulo' })
    const l = n('llm', 390, 120, { preset: 'image' })
    const ng = neg(390, 460)
    const i = n('image', 740, 100)
    const o = n('output', 1090, 140)
    return { nodes: [p, l, ng, i, o], edges: [e(p, 'text', l, 'text'), e(l, 'text', i, 'prompt'), e(ng, 'text', i, 'negative'), e(i, 'image', o, 'media')] }
  }
  if (id === 'image-video') {
    const ld = n('load', 80, 80)
    const p = n('prompt', 80, 340, { text: 'Slow camera push-in, gentle wind, cinematic motion' })
    const ng = neg(80, 560, true)
    const v = n('video', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [ld, p, ng, v, o], edges: [e(ld, 'image', v, 'image'), e(p, 'text', v, 'prompt'), e(ng, 'text', v, 'negative'), e(v, 'video', o, 'media')] }
  }
  if (id === 'edit') {
    const ld = n('load', 80, 100)
    const p = n('prompt', 80, 380, { text: 'Make it a snowy winter evening, keep the subject the same' })
    const ng = neg(80, 600)
    const ed = n('edit', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [ld, p, ng, ed, o], edges: [e(ld, 'image', ed, 'image'), e(p, 'text', ed, 'prompt'), e(ng, 'text', ed, 'negative'), e(ed, 'image', o, 'media')] }
  }
  if (id === 'inpaint') {
    const ld = n('load', 80, 100)
    const p = n('prompt', 80, 380, { text: 'a vase of red flowers' })
    const ng = neg(80, 600)
    const ip = n('inpaint', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [ld, p, ng, ip, o], edges: [e(ld, 'image', ip, 'image'), e(p, 'text', ip, 'prompt'), e(ng, 'text', ip, 'negative'), e(ip, 'image', o, 'media')] }
  }
  if (id === 'upscale-photo') {
    const ld = n('load', 80, 120)
    const up = n('upscale', 440, 140)
    const o = n('output', 800, 160)
    return { nodes: [ld, up, o], edges: [e(ld, 'image', up, 'image'), e(up, 'image', o, 'media')] }
  }
  if (id === 'recompose') {
    const ld = n('load', 80, 100)
    const p = n('prompt', 80, 380, { text: 'Keep the headline on the left and the artwork on the right' })
    const rc = n('recompose', 440, 140, { aspect: '16:9' })
    const o = n('output', 800, 180)
    return { nodes: [ld, p, rc, o], edges: [e(ld, 'image', rc, 'image'), e(p, 'text', rc, 'prompt'), e(rc, 'image', o, 'media')] }
  }
  if (id === 'extend') {
    const lv = n('loadvideo', 80, 100)
    const p = n('prompt', 80, 400, { text: 'The character lands, dusts off and walks away slowly. Steadicam follow shot, warm golden light. No black frames, no text overlays.' })
    const ng = neg(80, 640, true)
    const ex = n('extend', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [lv, p, ng, ex, o], edges: [e(lv, 'video', ex, 'video'), e(p, 'text', ex, 'prompt'), e(ng, 'text', ex, 'negative'), e(ex, 'video', o, 'media')] }
  }
  if (id === 'vector') {
    const p = n('prompt', 80, 120, { text: 'Minimal logo for a coffee roastery called Orbit: a bean orbiting a cup, two colors, flat' })
    const v = n('vector', 440, 120)
    const o = n('output', 800, 160)
    return { nodes: [p, v, o], edges: [e(p, 'text', v, 'prompt'), e(v, 'image', o, 'media')] }
  }
  if (id === 'soundtrack') {
    // Music is the tallest node (style and mood chips), so the others sit below it.
    const p = n('prompt', 60, 40, { text: 'Calm Brazilian bossa nova for a summer coffee ad, nylon guitar and soft percussion' })
    const mu = n('music', 420, 0, { genres: 'Bossa nova', moods: 'Calm', vocals: 'Instrumental' })
    const s = n('prompt', 60, 760, { text: 'Coffee being poured into a ceramic cup, close and warm' })
    const fx = n('sfx', 420, 760, { seconds: 4 })
    const vo = n('prompt', 60, 1180, { text: 'Seu café da manhã, do jeito que o verão pede.' })
    const v = n('voice', 420, 1180)
    const o = n('output', 820, 640)
    return {
      nodes: [p, mu, s, fx, vo, v, o],
      edges: [e(p, 'text', mu, 'prompt'), e(s, 'text', fx, 'prompt'), e(vo, 'text', v, 'text'), e(mu, 'audio', o, 'media'), e(fx, 'audio', o, 'media'), e(v, 'audio', o, 'media')],
    }
  }
  if (id === 'upscale') {
    const p = n('prompt', 60, 100, { text: 'Detailed portrait of an astronaut, studio light' })
    const ng = neg(60, 330)
    const i = n('image', 400, 100)
    const up = n('upscale', 760, 140)
    const o = n('output', 1110, 160)
    return { nodes: [p, ng, i, up, o], edges: [e(p, 'text', i, 'prompt'), e(ng, 'text', i, 'negative'), e(i, 'image', up, 'image'), e(up, 'image', o, 'media')] }
  }
  // campaign
  const p = n('prompt', 40, 260, { text: 'Launch of a minimalist smartwatch: calm, premium, soft light' })
  const l1 = n('llm', 370, 80, { preset: 'image' })
  const ng = neg(370, -200)
  const ngv = neg(720, -260, true)
  const i = n('image', 720, 40)
  const l2 = n('llm', 370, 470, { preset: 'script' })
  const vo = n('voice', 720, 500)
  const v = n('video', 1070, 120)
  const o = n('output', 1420, 260)
  return {
    nodes: [p, l1, ng, ngv, i, l2, vo, v, o],
    edges: [e(p, 'text', l1, 'text'), e(l1, 'text', i, 'prompt'), e(ng, 'text', i, 'negative'), e(i, 'image', v, 'image'), e(l1, 'text', v, 'prompt'), e(ngv, 'text', v, 'negative'), e(p, 'text', l2, 'text'), e(l2, 'text', vo, 'text'), e(v, 'video', o, 'media'), e(vo, 'audio', o, 'media'), e(i, 'image', o, 'media')],
  }
}
// Best models on Orbi Cloud (OpenRouter ids), in order of preference. Missing ones are skipped.
const BEST = {
  image: ['google/gemini-3-pro-image', 'openai/gpt-image-2', 'google/gemini-nano-banana-2.1', 'black-forest-labs/flux.2-max', 'bytedance-seed/seedream-5-0-pro'],
  edit: ['google/gemini-3-pro-image', 'openai/gpt-image-2', 'google/gemini-nano-banana-2.1', 'black-forest-labs/flux-3-image', 'qwen/qwen-image-3-pro'],
  video: ['google/veo-3.1', 'kwaivgi/kling-v3.0-pro', 'bytedance/seedance-2.5', 'bytedance/seedance-2.0', 'alibaba/wan-3.0-prime'],
}
const UPSCALE_MODELS = ['google/gemini-3-pro-image', 'google/gemini-nano-banana-2.1', 'openai/gpt-image-2', 'black-forest-labs/flux-3-image']
// The standard vector model first (the Pro ones cost several times more and stay one click away).
const VECTOR_MODELS = ['recraft/recraft-v4.1-vector', 'recraft/recraft-v4.1-pro-vector', 'recraft/recraft-v4-vector', 'recraft/recraft-v4-pro-vector']
// First of the preferred model ids that this list offers.
const pickBest = (choices: { key: string }[], ids: string[]) => ids.map((id) => choices.find((c) => c.key.endsWith(`::${id}`))?.key).find(Boolean)
const splitList = (v: unknown) => String(v || '').split('|').filter(Boolean)
// Art-director brief from the "Graphic design recomposer" workflow: new format, same design, no stretching.
const RECOMPOSE = [
  'Act as an expert art director and compositing specialist. Adapt the provided image to the new aspect ratio by expanding the background and rearranging its core elements. Never stretch, squish or letterbox the image.',
  'Canvas: extend the existing environment (sky, textures, walls, floors) seamlessly, matching the original lighting, grain and perspective. Do not shrink the image onto a blurred or colored background, and do not add new focal objects, characters or borders.',
  'Layout: treat typography, logos, hero imagery and credits as movable elements and reposition them for the new format with professional layout principles, using the new space on purpose. Keep each element’s proportions and every font, weight and text style identical.',
  'Keep the original hierarchy of headline, hero image and logo. The result must look designed from scratch for this format.',
].join('\n\n')

// A still of the last frame of a video, so a new shot can start exactly where the clip ends.
function lastFrame(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    v.onloadedmetadata = () => (v.currentTime = Math.max(0, v.duration - 0.05))
    v.onseeked = () => {
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d')!.drawImage(v, 0, 0)
      resolve(c.toDataURL('image/png'))
    }
    v.onerror = () => reject(new Error(t('Could not read the last frame of this video.')))
    v.src = url
  })
}

const TEMPLATES = [
  { id: 'text-image', label: 'Text → image' },
  { id: 'idea-image', label: 'Idea → AI prompt → image' },
  { id: 'image-video', label: 'Image → video' },
  { id: 'edit', label: 'Edit an image with words' },
  { id: 'inpaint', label: 'Inpaint: repaint one area' },
  { id: 'upscale', label: 'Generate and upscale 4×' },
  { id: 'upscale-photo', label: 'Upscale a photo to 4K' },
  { id: 'recompose', label: 'Recompose a design for a new format' },
  { id: 'vector', label: 'Logo or icon as vector (SVG)' },
  { id: 'extend', label: 'Extend a video' },
  { id: 'soundtrack', label: 'Soundtrack: music, sound effect and voiceover' },
  { id: 'campaign', label: 'Campaign: image, video and voiceover' },
]

export function NodeFlow(props: Omit<ComponentProps<typeof WorkflowEditor>, 'storageKey' | 'onBusyChange'>) {
  return <WorkflowTabs Editor={WorkflowEditor} editorProps={props} />
}

function WorkflowEditor({
  models,
  localStatus,
  onMediaCreated,
  onOpenModels,
  visible = true,
  pendingTemplate,
  onTemplateLoaded,
  storageKey = 'flow',
  workspaceName = 'Workflow',
  onBusyChange,
}: {
  models: ModelInfo[]
  localStatus: LocalStatus | null
  onMediaCreated: (m: MediaItem) => void
  onOpenModels: () => void
  visible?: boolean
  pendingTemplate?: { id: string; prompt: string; negative?: string } | null
  onTemplateLoaded?: () => void
  storageKey?: string
  workspaceName?: string
  onBusyChange?: (key: string, busy: boolean) => void
}) {
  const [nodes, setNodes] = useState<FNode[]>([])
  const [edges, setEdges] = useState<FEdge[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, z: 0.9 })
  const [marks, setMarks] = useState<Mark[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [ink, setInk] = useState({ color: INKS[0], size: 4 })
  const [markSel, setMarkSel] = useState<string | null>(null)
  const [editingMark, setEditingMark] = useState<string | null>(null)
  const [fly, setFly] = useState<null | 'pointer' | 'shapes' | 'pen' | 'templates' | 'media'>(null)
  const lastShape = useRef<'rect' | 'ellipse' | 'line' | 'arrow'>('rect')
  const marksRef = useRef(marks)
  marksRef.current = marks
  const savedRef = useRef({ nodes, edges, view, loaded, marks })
  savedRef.current = { nodes, edges, view, loaded, marks }
  useEffect(() => () => {
    const snapshot = savedRef.current
    if (snapshot.loaded) api.saveWorkflow(storageKey, 'Workflow', { nodes: snapshot.nodes.map((n) => ({ ...n, progress: undefined })), edges: snapshot.edges, view: snapshot.view, marks: snapshot.marks }).catch(console.error)
  }, [storageKey])
  const [wire, setWire] = useState<null | { from: string; fromPort: string; type: PortType; x: number; y: number }>(null)
  const [quickAdd, setQuickAdd] = useState<null | { sx: number; sy: number; wx: number; wy: number; q: string }>(null)
  const [libOpen, setLibOpen] = useState(false)
  const [running, setRunning] = useState(false)
  useEffect(() => { onBusyChange?.(storageKey, running) }, [running, onBusyChange, storageKey])
  const [toast, setToast] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaItem[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const stopRef = useRef(false)
  const activeMediaNode = useRef<string | null>(null)
  const jobNode = useRef(new Map<string, string>())
  const jobFor = (nodeId: string) => {
    const j = `${nodeId}-${Date.now().toString(36)}`
    jobNode.current.set(j, nodeId)
    return j
  }
  const mediaLock = useRef<Promise<unknown>>(Promise.resolve())

  // model choices
  const chatModels = useMemo(() => models.filter((m) => !m.image || !/image/i.test(m.id)), [models])
  const imageChoices = useMemo(
    () => [
      ...(CLOUD_ONLY ? [] : localStatus?.models.filter((m) => m.kind === 'image' && m.installed).map((m) => ({ key: `local::${m.id}`, label: `${m.name} · ${t('this PC')}` })) ?? []),
      ...models.filter((m) => m.image).map((m) => ({ key: `cloud::${m.key}`, label: `${m.name} · ${m.providerName}` })),
    ],
    [models, localStatus],
  )
  // Recraft's vector models get their own node; the editing nodes keep the raster ones.
  const vectorChoices = useMemo(() => models.filter((m) => m.image && /-vector$/.test(m.id)).map((m) => ({ key: `cloud::${m.key}`, label: m.name.replace(/^[^:]+:\s*/, '') })).sort((a, b) => VECTOR_MODELS.findIndex((id) => a.key.endsWith(id)) - VECTOR_MODELS.findIndex((id) => b.key.endsWith(id))), [models])
  const editChoices = useMemo(
    () =>
      CLOUD_ONLY
        ? models.filter((m) => m.image && !/-vector$/.test(m.id)).map((m) => ({ key: `cloud::${m.key}`, label: m.name.replace(/^[^:]+:\s*/, '') }))
        : (localStatus?.models.filter((m) => m.kind === 'image' && m.installed && m.gen?.ref).map((m) => ({ key: m.id, label: m.name })) ?? []),
    [localStatus, models],
  )
  const localImageChoices = useMemo(() => localStatus?.models.filter((m) => m.kind === 'image' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])
  const ttsVoices = useMemo(() => localStatus?.models.filter((m) => m.kind === 'tts' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])
  // Orbi Cloud: upscaling is done by the image models that redraw at 4K from a reference (best ones first).
  const upscalers = useMemo(
    () =>
      CLOUD_ONLY
        ? editChoices.filter((c) => UPSCALE_MODELS.some((id) => c.key.endsWith(`::${id}`))).sort((a, b) => UPSCALE_MODELS.findIndex((id) => a.key.endsWith(`::${id}`)) - UPSCALE_MODELS.findIndex((id) => b.key.endsWith(`::${id}`)))
        : (localStatus?.models.filter((m) => m.kind === 'upscale' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? []),
    [localStatus, editChoices],
  )
  const [maskFor, setMaskFor] = useState<string | null>(null)
  const inputImageOf = (id: string) => {
    const e = edges.find((x) => x.to === id && x.toPort === 'image')
    const src = e ? nodes.find((x) => x.id === e.from) : undefined
    const m = src?.out?.media || (src?.kind === 'load' ? media.find((x) => x.id === src.data.mediaId) : undefined)
    return m && m.kind === 'image' ? m.url : null
  }
  const cloud = useCloud()
  const videoChoices = useMemo(
    () => [
      ...(CLOUD_ONLY ? [] : (localStatus?.models.filter((m) => m.kind === 'video' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [])),
      ...(cloud.catalog?.video ?? []).map((v) => ({ key: `cloudvideo::${v.id}`, label: v.name.replace(/^[^:]+:\s*/, '') })),
    ],
    [localStatus, cloud.catalog],
  )

  // load / save
  useEffect(() => {
    api.getWorkflow(storageKey).then((w) => {
      const saved = w as null | { nodes?: FNode[]; edges?: FEdge[]; view?: typeof view; marks?: Mark[] }
      if (saved?.marks) setMarks(saved.marks)
      if (saved?.nodes?.length) {
        setNodes(saved.nodes.map((n) => ({ ...n, status: n.status === 'running' ? 'idle' : n.status, progress: undefined })))
        setEdges(saved.edges ?? [])
        if (saved.view) setView(saved.view)
      } else {
        const tpl = template('idea-image')
        setNodes(tpl.nodes)
        setEdges(tpl.edges)
      }
      setLoaded(true)
    })
    api.media().then(setMedia)
    api.boards().then(setBoards)
  }, [])
  useEffect(() => {
    if (!loaded) return
    const tm = setTimeout(() => api.saveWorkflow(storageKey, 'Workflow', { nodes: nodes.map((n) => ({ ...n, progress: undefined })), edges, view, marks }), 600)
    return () => clearTimeout(tm)
  }, [nodes, edges, view, marks, loaded, storageKey])
  useEffect(() => {
    if (!toast) return
    const tm = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(tm)
  }, [toast])
  useEffect(
    () =>
      on('local:progress', (p: { jobId?: string; step: number; total: number }) => {
        const id = p.jobId ? jobNode.current.get(p.jobId) : undefined
        if (id && p.total) patch(id, { progress: p.step / p.total })
      }),
    [],
  )

  const patch = useCallback((id: string, p: Partial<FNode>) => {
    nodesRef.current = nodesRef.current.map((n) => (n.id === id ? { ...n, ...p } : n))
    setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, ...p } : n)))
  }, [])
  const setData = (id: string, d: FNode['data']) => {
    const n = nodesRef.current.find((x) => x.id === id)
    if (n) patch(id, { data: { ...n.data, ...d } })
  }

  // ---------- geometry ----------
  const toWorld = (cx: number, cy: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }
  }
  const portPos = (n: FNode, portId: string, side: 'in' | 'out') => {
    const list = side === 'in' ? DEFS[n.kind].inputs : DEFS[n.kind].outputs
    const i = Math.max(0, list.findIndex((p) => p.id === portId))
    return { x: n.x + (side === 'in' ? 0 : NODE_W), y: n.y + portY(i) }
  }
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5)
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
  }

  // ---------- editing ----------
  const addNode = (kind: Kind, at?: { x: number; y: number }) => {
    const r = stageRef.current?.getBoundingClientRect()
    const center = at ?? (r ? toWorld(r.left + r.width / 2 - 140, r.top + r.height / 2 - 80) : { x: 200, y: 200 })
    const n: FNode = { id: uidN(), kind, x: Math.round(center.x), y: Math.round(center.y), data: DEFS[kind].data() }
    setNodes((cur) => [...cur, n])
    setSelected(n.id)
    return n
  }
  const removeNode = (id: string) => {
    setNodes((cur) => cur.filter((n) => n.id !== id))
    setEdges((cur) => cur.filter((e) => e.from !== id && e.to !== id))
    setSelected(null)
  }
  const duplicate = (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id)
    if (!n) return
    const c: FNode = { ...n, id: uidN(), x: n.x + 30, y: n.y + 30, out: undefined, status: 'idle', error: undefined }
    setNodes((cur) => [...cur, c])
    setSelected(c.id)
  }
  const loadTemplate = (id: string, prompt?: string, negative?: string) => {
    if (running) { setToast(t('Stop this workflow before replacing its nodes.')); return false }
    if (nodesRef.current.length > 1 && !confirm(t('Replace the current workflow with this template?'))) return false
    const tpl = template(id)
    if (prompt) {
      const p = tpl.nodes.find((x) => x.kind === 'prompt')
      if (p) p.data.text = prompt
    }
    if (negative) for (const x of tpl.nodes) if (x.kind === 'negative') x.data.text = negative
    // Orbi Cloud: every template starts on the best models for the job (the person can change any node).
    if (CLOUD_ONLY) {
      const pick = (choices: Choice[], ids: string[]) => ids.map((id) => choices.find((c) => c.key.endsWith(`::${id}`))?.key).find(Boolean)
      const bestChat = (chatModels.find((m) => /anthropic\/claude-sonnet/.test(m.id)) || chatModels.find((m) => /anthropic\/claude/.test(m.id)) || chatModels.find((m) => /openai\/gpt-5/.test(m.id)))?.key
      for (const x of tpl.nodes) {
        if (x.data.model) continue
        const model =
          x.kind === 'image'
            ? pick(imageChoices, BEST.image)
            : x.kind === 'edit' || x.kind === 'recompose' || x.kind === 'inpaint'
              ? pick(editChoices, BEST.edit)
              : x.kind === 'vector'
                ? pick(vectorChoices, VECTOR_MODELS)
                : x.kind === 'extend'
                  ? pick(videoChoices, BEST.video)
              : x.kind === 'upscale'
                ? pick(upscalers, UPSCALE_MODELS)
                : x.kind === 'video'
                  ? pick(videoChoices, BEST.video)
                  : x.kind === 'llm'
                    ? bestChat
                    : undefined
        if (model) x.data.model = model
        if (x.kind === 'video') x.data = { ...x.data, res: 1080, frames: 128, fps: 16 }
      }
    }
    setNodes(tpl.nodes)
    setEdges(tpl.edges)
    setView({ x: 40, y: 40, z: 0.85 })
    setTimeout(fit, 60)
    return true
  }
  // A template picked in the Launchpad.
  useEffect(() => {
    if (!loaded || !pendingTemplate) return
    loadTemplate(pendingTemplate.id, pendingTemplate.prompt, pendingTemplate.negative)
    onTemplateLoaded?.()
  }, [loaded, pendingTemplate])

  // Context for the magic wand: is this text going to a video, and which prompt sits next to this negative?
  const promptContext = (id: string) => {
    const targets = edges.filter((x) => x.from === id).map((x) => nodes.find((n) => n.id === x.to))
    const mode: 'image' | 'video' = targets.some((x) => x?.kind === 'video') ? 'video' : 'image'
    let positive = ''
    for (const tg of targets) {
      if (!tg) continue
      const src = edges.find((x) => x.to === tg.id && x.toPort === 'prompt')
      const sn = src && nodes.find((n) => n.id === src.from)
      if (sn) positive = String(sn.out?.text || sn.data.text || '')
      if (positive) break
    }
    return { mode, positive }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!visible) return
      if ((e.target as HTMLElement).closest('textarea, input, select, [contenteditable="true"]')) return
      if (!stageRef.current?.isConnected) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && markSel) {
        setMarks((cur) => cur.filter((m) => m.id !== markSel))
        setMarkSel(null)
        return
      }
      // Tool shortcuts, as in Firefly Boards / Figma.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase()
        const next: Tool | undefined = k === 'v' ? 'select' : k === 'h' ? 'hand' : k === 't' ? 'text' : k === 'm' ? 'rect' : k === 'l' ? 'ellipse' : k === 'p' ? 'pen' : e.key === '\\' ? 'line' : e.key === '|' ? 'arrow' : undefined
        if (next) {
          setTool(next)
          if (next === 'rect' || next === 'ellipse' || next === 'line' || next === 'arrow') lastShape.current = next
          return
        }
        if (k === 'n') return setLibOpen((v) => !v)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeNode(selected)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected) {
        e.preventDefault()
        duplicate(selected)
      }
      if (e.key === 'Escape') {
        setWire(null)
        setQuickAdd(null)
        setFly(null)
        setMarkSel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, visible, markSel])

  // ---------- pointer: pan, zoom, drag, wires ----------
  const pan = (e: RPointerEvent<HTMLElement>) => {
    const sx = e.clientX
    const sy = e.clientY
    const o = { ...view }
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: o.x + ev.clientX - sx, y: o.y + ev.clientY - sy }))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Drawing tools: drag out a shape or a pen stroke; a click with Text drops an editable note.
  const startMark = (e: RPointerEvent<HTMLElement>) => {
    // Keeps the click from moving focus away, which would close a fresh text note before typing.
    e.preventDefault()
    const type = tool as Mark['type']
    const p = toWorld(e.clientX, e.clientY)
    const id = uidN()
    const base: Mark = { id, type, x: Math.round(p.x), y: Math.round(p.y), w: 0, h: 0, color: ink.color, size: ink.size, ...(type === 'pen' ? { pts: [0, 0] } : {}), ...(type === 'text' ? { w: 240, h: 40, text: '' } : {}) }
    setMarks((cur) => [...cur, base])
    setMarkSel(id)
    if (type === 'text') {
      setEditingMark(id)
      setTool('select')
      return
    }
    const move = (ev: PointerEvent) => {
      const q = toWorld(ev.clientX, ev.clientY)
      setMarks((cur) =>
        cur.map((m) => {
          if (m.id !== id) return m
          if (type === 'pen') return { ...m, pts: [...(m.pts || []), Math.round(q.x - m.x), Math.round(q.y - m.y)] }
          return { ...m, w: Math.round(q.x - m.x), h: Math.round(q.y - m.y) }
        }),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // A click without dragging leaves nothing behind.
      setMarks((cur) => cur.filter((m) => m.id !== id || (m.type === 'pen' ? (m.pts?.length || 0) > 4 : Math.abs(m.w) + Math.abs(m.h) > 6)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const startMarkDrag = (id: string, e: RPointerEvent<Element>) => {
    if (tool !== 'select') return
    e.stopPropagation()
    setMarkSel(id)
    setSelected(null)
    const m = marks.find((x) => x.id === id)
    if (!m) return
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: PointerEvent) => setMarks((cur) => cur.map((x) => (x.id === id ? { ...x, x: Math.round(m.x + (ev.clientX - sx) / view.z), y: Math.round(m.y + (ev.clientY - sy) / view.z) } : x)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Files from this computer: they join the library, then feed a Load node.
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<null | { nodeId?: string; at?: { x: number; y: number } }>(null)
  const loadKind = (k: string): Kind | null => (k === 'image' ? 'load' : k === 'video' ? 'loadvideo' : k === 'audio' ? 'loadaudio' : null)
  const importFiles = async (files: File[], at?: { x: number; y: number }, nodeId?: string) => {
    let i = 0
    for (const f of files) {
      if (!/^(image|video|audio)\//.test(f.type)) {
        setToast(t('Only images, videos and audio can go on the canvas.'))
        continue
      }
      try {
        const dataUrl = await new Promise<string>((ok, bad) => {
          const r = new FileReader()
          r.onload = () => ok(String(r.result))
          r.onerror = () => bad(r.error)
          r.readAsDataURL(f)
        })
        const item = await api.importMedia({ name: f.name, dataUrl })
        if (!item) continue
        setMedia((cur) => [item, ...cur.filter((x) => x.id !== item.id)])
        if (nodeId) setData(nodeId, { mediaId: item.id })
        else {
          const kind = loadKind(item.kind)
          if (!kind) continue
          const n = addNode(kind, at ? { x: at.x + i * 40, y: at.y + i * 40 } : undefined)
          setNodes((cur) => cur.map((x) => (x.id === n.id ? { ...x, data: { ...x.data, mediaId: item.id } } : x)))
        }
        i++
      } catch (err) {
        setToast(`${t('Could not import')}: ${cleanErr(err)}`)
      }
    }
  }
  const onUpload = (nodeId: string | undefined, kind: 'image' | 'video' | 'audio' | 'any') => {
    uploadTarget.current = { nodeId }
    if (uploadRef.current) {
      uploadRef.current.accept = kind === 'any' ? 'image/*,video/*,audio/*' : `${kind}/*`
      uploadRef.current.multiple = !nodeId
      uploadRef.current.click()
    }
  }

  const onStageDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return
    setFly(null)
    const onEmpty = e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('flow-world')
    if (tool === 'hand' && !(e.target as HTMLElement).closest('.flow-node, .flow-rail')) return pan(e)
    if (tool !== 'select' && tool !== 'hand' && !(e.target as HTMLElement).closest('.flow-node, .flow-rail, .flow-zoom')) return startMark(e)
    if (!onEmpty) return
    setSelected(null)
    setMarkSel(null)
    setQuickAdd(null)
    const sx = e.clientX
    const sy = e.clientY
    const o = { ...view }
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: o.x + ev.clientX - sx, y: o.y + ev.clientY - sy }))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Panels floating over the canvas scroll themselves; only the canvas (and the nodes on it) zooms.
    if ((e.target as HTMLElement).closest('textarea, select, .flow-node-body-scroll, .flow-lib, .flow-quick, .flow-fly, .flow-rail, .flow-zoom')) return
    const r = stageRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    setView((v) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * (e.deltaY < 0 ? 1.1 : 0.9)))
      return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z }
    })
  }
  const startNodeDrag = (id: string, e: RPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return
    e.preventDefault()
    setSelected(id)
    const n = nodesRef.current.find((x) => x.id === id)!
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: PointerEvent) => patch(id, { x: Math.round(n.x + (ev.clientX - sx) / view.z), y: Math.round(n.y + (ev.clientY - sy) / view.z) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const startWire = (from: string, fromPort: string, type: PortType, e: RPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const p = toWorld(e.clientX, e.clientY)
    setWire({ from, fromPort, type, ...p })
    const move = (ev: PointerEvent) => setWire((w) => (w ? { ...w, ...toWorld(ev.clientX, ev.clientY) } : w))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-in-port]') as HTMLElement | null
      setWire(null)
      if (!el) return
      const to = el.dataset.node!
      const toPort = el.dataset.inPort!
      const toType = el.dataset.type as PortType
      if (to === from) return
      if (!compatible(type, toType)) {
        setToast(t('Those ports don’t match: {a} can’t go into {b}.', { a: t(type), b: t(toType) }))
        return
      }
      setEdges((cur) => [...cur.filter((x) => !(x.to === to && x.toPort === toPort && toType !== 'media') && !(x.from === from && x.fromPort === fromPort && x.to === to && x.toPort === toPort)), { id: uidN(), from, fromPort, to, toPort }])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Grab an existing wire by its input end to move or remove it.
  const grabInput = (nodeId: string, portId: string, e: RPointerEvent) => {
    const ex = edgesRef.current.filter((x) => x.to === nodeId && x.toPort === portId).pop()
    if (!ex) return
    setEdges((cur) => cur.filter((x) => x.id !== ex.id))
    const src = nodesRef.current.find((n) => n.id === ex.from)
    const type = src ? DEFS[src.kind].outputs.find((p) => p.id === ex.fromPort)?.type : undefined
    if (type) startWire(ex.from, ex.fromPort, type, e)
  }
  // Frames every node and annotation. Reads the refs, so it also works right after a template replaces the graph.
  const fit = () => {
    const r = stageRef.current?.getBoundingClientRect()
    const list = nodesRef.current
    if (!r || !list.length) return
    const boxes = [
      ...list.map((n) => [n.x, n.y, n.x + NODE_W, n.y + 320]),
      ...marksRef.current.map((m) => [Math.min(m.x, m.x + m.w), Math.min(m.y, m.y + m.h), Math.max(m.x, m.x + m.w), Math.max(m.y, m.y + m.h)]),
    ]
    const minX = Math.min(...boxes.map((b) => b[0]))
    const minY = Math.min(...boxes.map((b) => b[1]))
    const maxX = Math.max(...boxes.map((b) => b[2]))
    const maxY = Math.max(...boxes.map((b) => b[3]))
    const left = 76 // keeps clear of the floating tool rail
    const z = Math.min(1.2, Math.max(ZOOM_MIN, Math.min((r.width - left - 40) / (maxX - minX), (r.height - 80) / (maxY - minY))))
    setView({ z, x: left - minX * z + (r.width - left - 40 - (maxX - minX) * z) / 2, y: 40 - minY * z })
  }

  // ---------- execution ----------
  const inputsOf = (id: string) => edgesRef.current.filter((e) => e.to === id)
  const withMediaLock = <T,>(fn: () => Promise<T>) => {
    const p = mediaLock.current.then(fn, fn)
    mediaLock.current = p.catch(() => {})
    return p
  }

  // Everything a node makes joins the library and this canvas's own list (so Load nodes see it at once).
  const created = (item: MediaItem) => {
    onMediaCreated(item)
    setMedia((cur) => [item, ...cur.filter((x) => x.id !== item.id)])
  }
  // Coming back to the tab picks up what was made or imported elsewhere meanwhile.
  useEffect(() => {
    if (visible && loaded) api.media().then(setMedia)
  }, [visible])

  const execNode = async (n: FNode, ins: Record<string, Val[]>): Promise<Val> => {
    const firstText = (k: string) => ins[k]?.map((v) => v.text).filter(Boolean).join('\n\n') || ''
    const firstMedia = (k: string) => ins[k]?.find((v) => v.media)?.media
    // The node's own switch turns the negative input off without unwiring it.
    const negativeText = () => (n.data.negOff ? undefined : firstText('negative') || (n.data.negative ? String(n.data.negative) : '') || undefined)
    const done = (item: MediaItem): Val => {
      created(item)
      return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
    }
    const cloudImage = (key: string) => {
      const m = models.find((x) => x.key === key.replace(/^cloud::/, ''))
      if (!m) throw new Error(t('That image model is not connected anymore.'))
      return m
    }
    switch (n.kind) {
      case 'prompt':
      case 'negative':
      case 'note':
        return { text: String(n.data.text || '') }
      case 'load':
      case 'loadvideo':
      case 'loadaudio': {
        const want = n.kind === 'load' ? 'image' : n.kind === 'loadvideo' ? 'video' : 'audio'
        const m = media.find((x) => x.id === n.data.mediaId && x.kind === want)
        if (!m) throw new Error(want === 'image' ? t('Pick an image from your library.') : want === 'video' ? t('Pick a video from your library.') : t('Pick an audio file from your library.'))
        return { media: { id: m.id, url: m.url, name: m.name, kind: m.kind } }
      }
      case 'vector': {
        const prompt = firstText('prompt')
        if (!prompt) throw new Error(t('Connect a prompt to this node.'))
        const key = String(n.data.model || vectorChoices[0]?.key || '')
        if (!key) throw new Error(t('No vector model is available right now.'))
        const m = cloudImage(key)
        const ref = firstMedia('image')
        const refUrl = ref?.kind === 'image' ? (await api.mediaDataUrl(ref.id)) || undefined : undefined
        const spec = cloud.catalog?.image.find((x) => x.id === m.id)
        return done(await withMediaLock(() => api.generateImage({ providerId: m.provider, model: m.id, prompt, aspect: nearestAspect(aspectsFor({ aspects: spec?.aspects } as CreativeOption), String(n.data.aspect || '1:1')), refImages: refUrl ? [refUrl] : undefined, source: 'creative' })))
      }
      case 'recompose': {
        const img = firstMedia('image')
        if (!img || img.kind !== 'image') throw new Error(t('Connect an image to this node.'))
        const m = cloudImage(String(n.data.model || pickBest(editChoices, BEST.edit) || editChoices[0]?.key || ''))
        const dataUrl = (await api.mediaDataUrl(img.id)) || undefined
        const extra = firstText('prompt')
        const spec = cloud.catalog?.image.find((x) => x.id === m.id)
        const res = spec?.resolutions?.includes(String(n.data.resolution)) ? String(n.data.resolution) : undefined
        return done(
          await withMediaLock(() =>
            api.generateImage({ providerId: m.provider, model: m.id, prompt: extra ? `${RECOMPOSE}\n\nAlso: ${extra}` : RECOMPOSE, aspect: nearestAspect(aspectsFor({ aspects: spec?.aspects } as CreativeOption), String(n.data.aspect || '16:9')), resolution: res, refImages: dataUrl ? [dataUrl] : undefined, source: 'creative' }),
          ),
        )
      }
      case 'extend': {
        const clip = firstMedia('video')
        if (!clip || clip.kind !== 'video') throw new Error(t('Connect a video to this node.'))
        const prompt = firstText('prompt')
        if (!prompt) throw new Error(t('Connect a prompt to this node.'))
        const modelId = String(n.data.model || pickBest(videoChoices, BEST.video) || videoChoices[0]?.key || '').replace(/^cloudvideo::/, '')
        const spec = cloud.catalog?.video.find((v) => v.id === modelId)
        if (!spec) throw new Error(t('No video model yet — download one in Models.'))
        const frame = await lastFrame(clip.url)
        const neg = negativeText()
        const text = `Continuing from the previous shot: ${prompt}${neg ? `\n\nAvoid: ${neg}` : ''}`
        return done(
          await withMediaLock(() =>
            api.cloudVideo({ jobId: jobFor(n.id), model: modelId, prompt: text, duration: nearestDuration(spec.durations ?? [5], Number(n.data.duration) || 5), resolution: String(n.data.resolution || spec.resolutions?.[0] || '720p'), aspect: nearestAspect(spec.aspects?.length ? spec.aspects : ['16:9'], String(n.data.aspect || '16:9')), audio: spec.audio ? n.data.audio !== 0 : undefined, frameImage: frame, source: 'creative' }),
          ),
        )
      }
      case 'music': {
        const description = firstText('prompt') || String(n.data.text || '')
        const genres = splitList(n.data.genres)
        if (!description && !genres.length) throw new Error(t('Describe the music or pick a genre.'))
        const list = cloud.catalog?.music ?? []
        const mm = list.find((x) => x.id === n.data.model) ?? list[0]
        if (!mm) throw new Error(t('No music model is available right now.'))
        const prompt = musicPrompt({ description, genres, moods: splitList(n.data.moods), bpm: Number(n.data.bpm) || 0, vocals: String(n.data.vocals || 'Instrumental'), language: String(n.data.language || 'Any language'), length: Number(n.data.length) || 0, lyrics: firstText('lyrics') || String(n.data.lyrics || ''), fullSong: !(mm.seconds && mm.seconds <= 30) })
        return done(await withMediaLock(() => api.cloudMusic({ model: mm.id, prompt, source: 'creative' })))
      }
      case 'sfx': {
        const description = firstText('prompt')
        if (!description) throw new Error(t('Describe the sound.'))
        const list = cloud.catalog?.sfx ?? []
        const sm = list.find((x) => x.id === n.data.model) ?? list[0]
        if (!sm) throw new Error(t('No sound-effect model is available right now.'))
        const text = sfxPrompt({ description, seconds: Number(n.data.seconds) || 5, intensity: String(n.data.intensity || 'Medium'), space: String(n.data.space || ''), loop: !!n.data.loop })
        return done(await withMediaLock(() => api.speech({ text, model: sm.id, voice: sm.voices[0], purpose: 'sfx', source: 'creative' })))
      }
      case 'llm': {
        const input = firstText('text')
        if (!input) throw new Error(t('Connect some text to this node.'))
        const key = String(n.data.model || chatModels[0]?.key || '')
        const m = chatModels.find((x) => x.key === key)
        if (!m) throw new Error(t('Connect a chat model first (cloud provider or a local text model).'))
        const preset = PRESETS[String(n.data.preset || 'image')] || PRESETS.image
        const system = preset.system || String(n.data.instruction || 'Follow the instruction.')
        const prompt = n.data.preset === 'custom' && n.data.instruction ? `${n.data.instruction}\n\n${input}` : input
        const text = await api.complete({ providerId: m.provider, model: m.id, system, prompt })
        return { text: text.trim() }
      }
      case 'image': {
        const prompt = firstText('prompt')
        if (!prompt) throw new Error(t('Connect a prompt to this node.'))
        const choice = String(n.data.model || imageChoices[0]?.key || '')
        if (!choice) throw new Error(t('No image model yet — download one in Models or connect a provider.'))
        const [w0, h0] = ratioOf(String(n.data.aspect || '1:1'))
        const base = 768
        const width = snap64(Math.sqrt((base * base * w0) / h0))
        const height = snap64((width * h0) / w0)
        const init = firstMedia('image')
        const item = await withMediaLock(async () => {
          activeMediaNode.current = n.id
          try {
            if (choice.startsWith('local::')) {
              const initImage = init && init.kind === 'image' ? (await api.mediaDataUrl(init.id)) || undefined : undefined
              return await api.generateLocal({
                jobId: jobFor(n.id),
                modelId: choice.slice(7),
                negative: negativeText(),
                prompt,
                width,
                height,
                steps: Number(n.data.steps) || undefined,
                seed: n.data.seed === '' || n.data.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(n.data.seed),
                initImage,
                strength: Number(n.data.strength) || 0.65,
              })
            }
            const m = models.find((x) => x.key === choice.slice(7))
            if (!m) throw new Error(t('That image model is not connected anymore.'))
            const ref = init && init.kind === 'image' ? (await api.mediaDataUrl(init.id)) || undefined : undefined
            const neg = negativeText()
            const spec = cloud.catalog?.image.find((x) => x.id === m.id)
            const list = aspectsFor({ aspects: spec?.aspects } as CreativeOption)
            return await api.generateImage({ providerId: m.provider, model: m.id, prompt: neg ? `${prompt}\n\nAvoid: ${neg}` : prompt, width, height, aspect: nearestAspect(list, String(n.data.aspect || '1:1')), refImages: ref ? [ref] : undefined, source: 'creative' })
          } finally {
            activeMediaNode.current = null
          }
        })
        created(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'video': {
        const prompt = firstText('prompt')
        if (!prompt) throw new Error(t('Connect a prompt to this node.'))
        const modelId = String(n.data.model || videoChoices[0]?.key || '')
        if (!modelId) throw new Error(t('No video model yet — download one in Models.'))
        const init = firstMedia('image')
        const item = await withMediaLock(async () => {
          activeMediaNode.current = n.id
          try {
            const initImage = init && init.kind === 'image' ? (await api.mediaDataUrl(init.id)) || undefined : undefined
            if (modelId.startsWith('cloudvideo::')) {
              const spec = cloud.catalog?.video.find((v) => v.id === modelId.slice(12))
              const neg = negativeText()
              // Seconds and resolution come straight from the model's own options (older nodes kept frames/fps).
              const seconds = Number(n.data.duration) || Math.round((Number(n.data.frames) || 81) / (Number(n.data.fps) || 16))
              const res = spec?.resolutions?.includes(String(n.data.resolution)) ? String(n.data.resolution) : nearestRes(spec?.resolutions ?? ['720p'], Number(n.data.res) || 720)
              return await api.cloudVideo({
                jobId: jobFor(n.id),
                model: modelId.slice(12),
                prompt: neg ? `${prompt}\n\nAvoid: ${neg}` : prompt,
                duration: nearestDuration(spec?.durations ?? [5], seconds),
                resolution: res,
                aspect: nearestAspect(spec?.aspects?.length ? spec.aspects : ['16:9'], String(n.data.aspect || '16:9')),
                audio: spec?.audio ? n.data.audio !== 0 : undefined,
                frameImage: initImage,
                source: 'creative',
              })
            }
            return await api.generateLocal({ jobId: jobFor(n.id), modelId, prompt, negative: negativeText(), frames: Number(n.data.frames) || 33, fps: Number(n.data.fps) || undefined, initImage, seed: Math.floor(Math.random() * 2 ** 31) })
          } finally {
            activeMediaNode.current = null
          }
        })
        created(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'edit':
      case 'inpaint': {
        const img = firstMedia('image')
        if (!img || img.kind !== 'image') throw new Error(t('Connect an image to this node.'))
        const prompt = firstText('prompt')
        if (!prompt) throw new Error(t('Connect a prompt to this node.'))
        const list = n.kind === 'edit' || CLOUD_ONLY ? editChoices : localImageChoices
        const modelId = String(n.data.model || list[0]?.key || '')
        if (!modelId) throw new Error(n.kind === 'edit' ? t('Image editing needs an editing model (FLUX.2 or FLUX.3 Klein, Mage-Flow Edit or Qwen Image Edit) — download one in Models.') : t('No image model yet — download one in Models or connect a provider.'))
        if (n.kind === 'inpaint' && !n.data.mask) throw new Error(t('Paint the area to change first (Paint mask).'))
        const dataUrl = (await api.mediaDataUrl(img.id)) || undefined
        const size = await new Promise<{ w: number; h: number }>((ok) => {
          const im = new Image()
          im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight })
          im.onerror = () => ok({ w: 768, h: 768 })
          im.src = img.url
        })
        const scaleTo = Math.min(1, 1024 / Math.max(size.w, size.h))
        if (modelId.startsWith('cloud::')) {
          const m = cloudImage(modelId)
          const neg = negativeText()
          // Cloud inpaint: the painted mask goes as a second reference and the prompt confines the change to it.
          const refs = [dataUrl, n.kind === 'inpaint' ? String(n.data.mask) : undefined].filter((x): x is string => !!x)
          const text =
            n.kind === 'inpaint'
              ? `Edit only the area that is white in the second image (the mask); keep every pixel outside it identical. In that area: ${prompt}. Blend lighting, perspective and edges naturally.${neg ? ` Avoid: ${neg}` : ''}`
              : neg
                ? `${prompt}\n\nAvoid: ${neg}`
                : prompt
          return done(await withMediaLock(() => api.generateImage({ providerId: m.provider, model: m.id, prompt: text, width: snap64(size.w * scaleTo), height: snap64(size.h * scaleTo), refImages: refs, source: 'creative' })))
        }
        const item = await withMediaLock(() =>
          api.generateLocal({
            jobId: jobFor(n.id),
            modelId,
            prompt,
            negative: negativeText(),
            width: snap64(size.w * scaleTo),
            height: snap64(size.h * scaleTo),
            ...(n.kind === 'edit' ? { refImages: dataUrl ? [dataUrl] : [] } : { initImage: dataUrl, mask: String(n.data.mask), strength: Number(n.data.strength) || 0.85 }),
            seed: Math.floor(Math.random() * 2 ** 31),
          }),
        )
        created(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'upscale': {
        const img = firstMedia('image')
        if (!img || img.kind !== 'image') throw new Error(t('Connect an image to this node.'))
        if (!upscalers.length) throw new Error(CLOUD_ONLY ? t('The image models did not load from Orbi Cloud. Check your internet and try again.') : t('Download an upscaler in Models (Image → Upscalers).'))
        const upKey = String(n.data.model || upscalers[0].key)
        if (upKey.startsWith('cloud::')) {
          const m = models.find((x) => x.key === upKey.slice(7))
          if (!m) throw new Error(t('That image model is not connected anymore.'))
          const dataUrl = (await api.mediaDataUrl(img.id)) || undefined
          const size = await new Promise<{ w: number; h: number }>((ok) => {
            const im = new Image()
            im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight })
            im.onerror = () => ok({ w: 1024, h: 1024 })
            im.src = img.url
          })
          const item = await withMediaLock(() =>
            api.generateImage({
              providerId: m.provider,
              model: m.id,
              prompt: 'Upscale this image to 4K. Keep the composition, subject, faces, text, colors and lighting exactly the same; only add resolution, fine detail and sharpness. Do not add or remove anything.',
              width: size.w,
              height: size.h,
              resolution: '4K',
              refImages: dataUrl ? [dataUrl] : undefined,
              source: 'creative',
            }),
          )
          created(item)
          return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
        }
        const item = await withMediaLock(() => api.upscale({ mediaId: img.id, modelId: String(n.data.model || upscalers[0].key), jobId: jobFor(n.id) }))
        created(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'voice': {
        const text = firstText('text')
        if (!text) throw new Error(t('Connect a script to this node.'))
        if (CLOUD_ONLY) {
          const cv = parseCloudVoice(n.data.voice, cloud.catalog)
          const item = await api.speech({ text: withStyle(cv.model, String(n.data.style || ''), text), model: cv.model || undefined, voice: cv.voice || undefined, source: 'creative' })
          created(item)
          return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
        }
        const v = parseVoice(n.data.voice, ttsVoices)
        const item =
          v.type === 'local'
            ? await api.speakToMedia({ text, modelId: v.modelId, voice: v.voice, lang: getLang() })
            : v.type === 'native'
              ? await api.speakSystemToMedia({ text, system: v.id })
              : await api.speech({ text, voice: v.voice })
        created(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'output': {
        const items = (ins.media || []).map((v) => v.media).filter((m): m is Media => !!m)
        if (!items.length) throw new Error(t('Nothing arrived here yet.'))
        if (n.data.board) for (const m of items) await api.setMediaBoard(m.id, String(n.data.board))
        return { media: items[items.length - 1] }
      }
    }
  }

  // Runs a node after its inputs; `memo` makes each node run once per run.
  const runNode = async (id: string, memo: Map<string, Promise<Val | undefined>>, force: (nid: string) => boolean): Promise<Val | undefined> => {
    if (memo.has(id)) return memo.get(id)
    const job = (async () => {
      const n = nodesRef.current.find((x) => x.id === id)
      if (!n) return undefined
      if (!force(id) && n.out && n.status === 'done') return n.out
      const ins: Record<string, Val[]> = {}
      for (const e of inputsOf(id)) {
        const v = await runNode(e.from, memo, force)
        if (stopRef.current) throw new Error(t('Stopped.'))
        if (v) (ins[e.toPort] ||= []).push(v)
      }
      patch(id, { status: 'running', error: undefined, progress: undefined })
      try {
        const out = await execNode(nodesRef.current.find((x) => x.id === id)!, ins)
        patch(id, { status: 'done', out, progress: undefined })
        if (CLOUD_ONLY && n.kind !== 'prompt' && n.kind !== 'negative' && n.kind !== 'note' && n.kind !== 'load' && n.kind !== 'output') setTimeout(() => refreshCloud(), 2500)
        return out
      } catch (err) {
        const msg = cleanErr(err)
        patch(id, { status: 'error', error: msg, progress: undefined })
        throw new Error(msg)
      }
    })()
    memo.set(id, job)
    return job
  }

  const runOne = async (id: string) => {
    stopRef.current = false
    setRunning(true)
    const n = nodesRef.current.find((x) => x.id === id)
    const act = activity.start({ area: 'creative', kind: 'workflow', label: `${workspaceName} · ${t(DEFS[n?.kind || 'image'].title)}` })
    let ok = true
    try {
      await runNode(id, new Map(), (nid) => nid === id)
    } catch {
      ok = false
    } finally {
      setRunning(false)
      activity.end(act, { ok, message: ok ? t('Workflow node finished.') : t('A workflow node failed.') })
    }
  }
  const runAll = async () => {
    stopRef.current = false
    setRunning(true)
    const act = activity.start({ area: 'creative', kind: 'workflow', label: workspaceName })
    const memo = new Map<string, Promise<Val | undefined>>()
    const ends = nodesRef.current.filter((n) => n.kind !== 'note' && n.kind !== 'negative' && !edgesRef.current.some((e) => e.from === n.id))
    let failed = 0
    for (const n of ends) {
      try {
        await runNode(n.id, memo, () => true)
      } catch {
        failed++
      }
      if (stopRef.current) break
    }
    setRunning(false)
    activity.end(act, { ok: !failed && !stopRef.current, message: stopRef.current ? t('Workflow stopped.') : failed ? t('Workflow finished with errors — check the red notes on the nodes.') : t('Workflow finished. Results are in your Gallery.') })
    api.media().then(setMedia)
    setToast(stopRef.current ? t('Workflow stopped.') : failed ? t('Workflow finished with errors — check the red notes on the nodes.') : t('Workflow finished. Results are in your Gallery.'))
  }
  const stopAll = () => {
    stopRef.current = true
    for (const j of jobNode.current.keys()) api.cancelLocalGenerate(j)
  }

  // ---------- files: Orbi workflow JSON and ComfyUI import ----------
  const fileRef = useRef<HTMLInputElement>(null)
  const pickLocal = (names: string[], kind: 'image' | 'video') => {
    const installed = localStatus?.models.filter((m) => m.kind === kind && m.installed) ?? []
    const hint = names.join(' ').toLowerCase()
    const rules: [RegExp, string][] = [
      [/flux[_.-]?3|image[_-]?klein/, 'flux3-klein'],
      [/krea/, 'krea2-turbo'],
      [/mage[_-]?flow[_-]?edit/, 'mage-flow-edit-turbo'],
      [/mage[_-]?flow/, 'mage-flow-turbo'],
      [/qwen[_-]?image[_-]?edit/, 'qwen-image-edit-2511'],
      [/klein[_-]?9b/, 'flux2-klein-9b'],
      [/ltx/, 'ltx2.3'],
      [/z[_-]?image/, 'z-image-turbo'],
      [/flux[_.-]?2|klein/, 'flux2-klein-4b'],
      [/flux/, 'flux-schnell'],
      [/wan2[._]?2|ti2v/, 'wan2.2-5b-q4'],
      [/wan/, 'wan2.1-1.3b'],
    ]
    for (const [re, id] of rules) if (re.test(hint) && installed.some((m) => m.id === id)) return id
    return installed[0]?.id
  }
  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text())
      if (json?.orbi === 'workflow' && Array.isArray(json.nodes)) {
        setNodes(json.nodes.map((n: FNode) => ({ ...n, status: 'idle', out: n.kind === 'prompt' || n.kind === 'note' ? n.out : undefined })))
        setEdges(json.edges || [])
        setToast(t('Workflow imported.'))
      } else {
        const r = importComfy(json)
        const img = pickLocal(r.models, 'image')
        const vid = pickLocal(r.models, 'video')
        setNodes(
          r.nodes.map((n) => ({
            ...n,
            data: { ...DEFS[n.kind as Kind].data(), ...n.data, ...(n.kind === 'image' && img ? { model: `local::${img}` } : {}), ...(n.kind === 'video' && vid ? { model: vid } : {}) },
          })) as FNode[],
        )
        // Negative texts from ComfyUI samplers become Negative prompt nodes.
        const extraNodes: FNode[] = []
        const extraEdges: FEdge[] = []
        for (const n of r.nodes as FNode[]) {
          if (!['image', 'video'].includes(n.kind) || !n.data?.negative) continue
          const ng: FNode = { id: uidN(), kind: 'negative', x: n.x - 330, y: n.y + 260, data: { text: String(n.data.negative) } }
          extraNodes.push(ng)
          extraEdges.push({ id: uidN(), from: ng.id, fromPort: 'text', to: n.id, toPort: 'negative' })
        }
        if (extraNodes.length) setNodes((cur) => [...cur.map((x) => (extraEdges.some((e) => e.to === x.id) ? { ...x, data: { ...x.data, negative: undefined } } : x)), ...extraNodes])
        setEdges([...r.edges, ...extraEdges])
        setToast(r.unsupported.length ? t('ComfyUI workflow imported. Not available yet: {list}', { list: r.unsupported.slice(0, 4).join(', ') }) : t('ComfyUI workflow imported.'))
      }
      setTimeout(fit, 50)
    } catch (e) {
      setToast(`${t('Could not import')}: ${cleanErr(e)}`)
    }
  }
  const exportFile = () => {
    const data = JSON.stringify({ orbi: 'workflow', version: 1, nodes: nodes.map(({ out, status, error, progress, ...n }) => ({ ...n, ...(n.kind === 'prompt' || n.kind === 'note' ? { out } : {}) })), edges }, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    a.download = 'orbi-workflow.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // ---------- render ----------
  const libItems = (Object.keys(DEFS) as Kind[]).map((k) => ({ kind: k, ...DEFS[k] }))
  const quickItems = quickAdd ? libItems.filter((d) => `${t(d.title)} ${d.title} ${t(d.hint)}`.toLowerCase().includes(quickAdd.q.toLowerCase())) : []

  return (
    <div className="flow-wrap" style={visible ? undefined : { display: 'none' }}>
      <div className="flow-bar">
        <button className="orbi-btn" disabled={running} onClick={() => fileRef.current?.click()} title={t('Open an Orbi or ComfyUI workflow (.json)')}>
          <FileUp size={13} /> {t('Import')}
        </button>
        <button className="orbi-btn" onClick={exportFile} title={t('Save this workflow as .json')}>
          <FileDown size={13} /> {t('Export')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importFile(f)
            e.target.value = ''
          }}
        />
        <input
          ref={uploadRef}
          type="file"
          hidden
          onChange={(e) => {
            const files = [...(e.target.files || [])]
            const target = uploadTarget.current
            e.target.value = ''
            if (files.length) importFiles(files, target?.at, target?.nodeId)
          }}
        />
        <span className="flow-hint">{t('Drag from a ● output to an input · double-click to add a node · drop photos, videos or audio on the canvas')}</span>
        <span className="flex-1" />
        <button className="orbi-btn" onClick={() => setNodes((cur) => cur.map((n) => ({ ...n, out: n.kind === 'prompt' || n.kind === 'note' ? n.out : undefined, status: 'idle', error: undefined })))} title={t('Clear results')}>
          <Trash2 size={13} /> {t('Clear results')}
        </button>
        {running ? (
          <button className="orbi-btn" onClick={stopAll}>
            <Square size={12} /> {t('Stop')}
          </button>
        ) : null}
        <button className="studio-invoke-btn flow-run" disabled={running} onClick={runAll}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {running ? t('Running…') : t('Run workflow')}
        </button>
      </div>

      <div
        className={`flow-stage tool-${tool}`}
        ref={stageRef}
        onPointerDown={onStageDown}
        onWheel={onWheel}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files]
          if (!files.length) return
          e.preventDefault()
          importFiles(files, toWorld(e.clientX, e.clientY))
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('input, textarea, select')) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const w = toWorld(e.clientX, e.clientY)
          setQuickAdd({ sx: Math.max(8, Math.min(e.clientX - r.left, r.width - 296)), sy: Math.max(8, Math.min(e.clientY - r.top, r.height - 340)), wx: w.x, wy: w.y, q: '' })
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('flow-world')) return
          const r = stageRef.current!.getBoundingClientRect()
          const w = toWorld(e.clientX, e.clientY)
          setQuickAdd({ sx: Math.max(8, Math.min(e.clientX - r.left, r.width - 296)), sy: Math.max(8, Math.min(e.clientY - r.top, r.height - 340)), wx: w.x, wy: w.y, q: '' })
        }}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${gridStep(view.z)}px ${gridStep(view.z)}px` }}
      >
        <div className="flow-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className={`flow-marks ${tool === 'select' ? 'pickable' : ''}`} width="1" height="1">
            <defs>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {marks
              .filter((m) => m.type !== 'text')
              .map((m) => {
                const common = { stroke: m.color, strokeWidth: m.size, fill: 'none', className: `flow-mark ${markSel === m.id ? 'selected' : ''}`, onPointerDown: (e: RPointerEvent<SVGElement>) => startMarkDrag(m.id, e) }
                const x = Math.min(m.x, m.x + m.w)
                const y = Math.min(m.y, m.y + m.h)
                if (m.type === 'rect') return <rect key={m.id} {...common} x={x} y={y} width={Math.abs(m.w)} height={Math.abs(m.h)} rx={8} />
                if (m.type === 'ellipse') return <ellipse key={m.id} {...common} cx={m.x + m.w / 2} cy={m.y + m.h / 2} rx={Math.abs(m.w / 2)} ry={Math.abs(m.h / 2)} />
                if (m.type === 'line' || m.type === 'arrow') return <line key={m.id} {...common} strokeLinecap="round" x1={m.x} y1={m.y} x2={m.x + m.w} y2={m.y + m.h} markerEnd={m.type === 'arrow' ? 'url(#flow-arrow)' : undefined} />
                const pts = m.pts || []
                const d = pts.reduce((s, v, i) => (i % 2 ? s + `${m.y + v} ` : s + `${i ? 'L' : 'M'}${m.x + v},`), '')
                return <path key={m.id} {...common} d={d} strokeLinecap="round" strokeLinejoin="round" />
              })}
          </svg>
          {marks
            .filter((m) => m.type === 'text')
            .map((m) => (
              <div
                key={m.id}
                className={`flow-text-mark ${markSel === m.id ? 'selected' : ''}`}
                style={{ left: m.x, top: m.y, width: m.w, color: m.color, fontSize: 10 + m.size * 2.5 }}
                onPointerDown={(e) => editingMark !== m.id && startMarkDrag(m.id, e)}
                onDoubleClick={() => setEditingMark(m.id)}
              >
                {editingMark === m.id ? (
                  <textarea
                    autoFocus
                    rows={2}
                    value={m.text || ''}
                    placeholder={t('Write a thought…')}
                    onChange={(e) => setMarks((cur) => cur.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)))}
                    onBlur={() => {
                      setEditingMark(null)
                      setMarks((cur) => cur.filter((x) => x.id !== m.id || (x.text || '').trim()))
                    }}
                  />
                ) : (
                  m.text
                )}
              </div>
            ))}
          <svg className="flow-wires" width="1" height="1">
            {edges.map((e) => {
              const a = nodes.find((n) => n.id === e.from)
              const b = nodes.find((n) => n.id === e.to)
              if (!a || !b) return null
              const pa = portPos(a, e.fromPort, 'out')
              const pb = portPos(b, e.toPort, 'in')
              const type = DEFS[a.kind].outputs.find((p) => p.id === e.fromPort)?.type || 'text'
              const live = a.status === 'running' || b.status === 'running'
              return (
                <g key={e.id} className={`flow-wire wire-${type} ${live ? 'live' : ''}`}>
                  <path d={curve(pa, pb)} className="flow-wire-hit" onClick={() => setEdges((cur) => cur.filter((x) => x.id !== e.id))}>
                    <title>{t('Click to remove')}</title>
                  </path>
                  <path d={curve(pa, pb)} className="flow-wire-line" />
                </g>
              )
            })}
            {wire &&
              (() => {
                const a = nodes.find((n) => n.id === wire.from)
                if (!a) return null
                return <path d={curve(portPos(a, wire.fromPort, 'out'), wire)} className={`flow-wire-line flow-wire-temp wire-${wire.type}`} />
              })()}
          </svg>

          {nodes.map((n) => {
            const def = DEFS[n.kind]
            const Icon = def.icon
            const ports = Math.max(def.inputs.length, def.outputs.length)
            return (
              <div
                key={n.id}
                className={`flow-node kind-${n.kind} ${selected === n.id ? 'selected' : ''} status-${n.status || 'idle'}`}
                style={{ left: n.x, top: n.y, width: NODE_W, ['--node-color' as string]: def.color }}
                onPointerDown={() => setSelected(n.id)}
              >
                <header className="flow-node-head" onPointerDown={(e) => startNodeDrag(n.id, e)}>
                  <span className="flow-node-icon">
                    <Icon size={14} />
                  </span>
                  <strong>{t(def.title)}</strong>
                  {n.status === 'running' && <Loader2 size={13} className="animate-spin" />}
                  <span className="flex-1" />
                  {n.kind !== 'note' && (
                    <button title={t('Run this node')} disabled={running} onClick={() => runOne(n.id)}>
                      <Play size={12} />
                    </button>
                  )}
                  <button title={t('Duplicate (Ctrl+D)')} onClick={() => duplicate(n.id)}>
                    <Copy size={12} />
                  </button>
                  <button title={t('Delete (Del)')} onClick={() => removeNode(n.id)}>
                    <X size={13} />
                  </button>
                </header>
                {ports > 0 && (
                  <div className="flow-ports" style={{ height: ports * PORT_H + 4 }}>
                    {def.inputs.map((p, i) => {
                      const connected = edges.some((e) => e.to === n.id && e.toPort === p.id)
                      return (
                        <div key={p.id} className="flow-port in" style={{ top: portY(i) - HEAD_H - 9 }}>
                          <span
                            className={`flow-dot type-${p.type} ${connected ? 'on' : ''}`}
                            data-in-port={p.id}
                            data-node={n.id}
                            data-type={p.type}
                            onPointerDown={(e) => connected && grabInput(n.id, p.id, e)}
                          />
                          <span>
                            {t(p.label)}
                            {p.optional ? <em> · {t('optional')}</em> : null}
                          </span>
                        </div>
                      )
                    })}
                    {def.outputs.map((p, i) => (
                      <div key={p.id} className="flow-port out" style={{ top: portY(i) - HEAD_H - 9 }}>
                        <span>{t(p.label)}</span>
                        <span className={`flow-dot type-${p.type} ${edges.some((e) => e.from === n.id && e.fromPort === p.id) ? 'on' : ''}`} onPointerDown={(e) => startWire(n.id, p.id, p.type, e)} title={t('Drag to connect')} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="flow-node-body">
                  <NodeBody
                    n={n}
                    setData={(d) => setData(n.id, d)}
                    chatModels={chatModels}
                    imageChoices={imageChoices}
                    videoChoices={videoChoices}
                    media={media}
                    boards={boards}
                    onOpenModels={onOpenModels}
                    extra={{ vectorChoices, onUpload: (id, kind) => onUpload(id, kind), editChoices, localImageChoices, upscalers, ttsVoices, onPaintMask: () => setMaskFor(n.id), hasInputImage: !!inputImageOf(n.id), localStatus, models, promptContext, catalog: cloud.catalog, admin: !!cloud.state?.user?.admin }}
                  />
                  {n.status === 'running' && n.progress !== undefined && (
                    <div className="local-bar">
                      <i style={{ width: `${Math.max(3, n.progress * 100)}%` }} />
                    </div>
                  )}
                  {n.error && <p className="flow-error">{n.error}</p>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Floating tool rail: stays put while you pan and zoom (Firefly Boards / Miro style). */}
        <div className="flow-rail" role="toolbar" aria-label={t('Canvas tools')} onPointerDown={(e) => e.stopPropagation()}>
          <RailButton active={tool === 'select' || tool === 'hand'} more onClick={() => (setTool(tool === 'hand' ? 'hand' : 'select'), setFly(fly === 'pointer' ? null : 'pointer'))} label={t('Select')} icon={tool === 'hand' ? Hand : MousePointer2} />
          <RailButton active={libOpen} onClick={() => (setLibOpen((v) => !v), setFly(null))} label={`${t('Add a node')} (N)`} icon={PackagePlus} />
          <RailButton active={fly === 'templates'} onClick={() => setFly(fly === 'templates' ? null : 'templates')} label={t('Templates')} icon={LayoutTemplate} />
          <RailButton active={tool === 'text'} onClick={() => (setTool('text'), setFly(null))} label={`${t('Text')} (T)`} icon={Type} />
          <RailButton active={['rect', 'ellipse', 'line', 'arrow'].includes(tool)} more onClick={() => (setTool(lastShape.current), setFly(fly === 'shapes' ? null : 'shapes'))} label={t('Shapes')} icon={lastShape.current === 'ellipse' ? Circle : lastShape.current === 'line' ? Slash : lastShape.current === 'arrow' ? MoveUpRight : RectangleHorizontal} />
          <RailButton active={tool === 'pen'} more onClick={() => (setTool('pen'), setFly(fly === 'pen' ? null : 'pen'))} label={`${t('Draw')} (P)`} icon={Pencil} />
          <RailButton active={fly === 'media'} onClick={() => setFly(fly === 'media' ? null : 'media')} label={t('Add media')} icon={ImagePlus} />

          {fly === 'pointer' && (
            <div className="flow-fly" style={{ top: 0 }}>
              <FlyItem on={tool === 'select'} icon={MousePointer2} label={t('Select')} keys="V" onClick={() => (setTool('select'), setFly(null))} />
              <FlyItem on={tool === 'hand'} icon={Hand} label={t('Hand')} keys="H" onClick={() => (setTool('hand'), setFly(null))} />
              {marks.length > 0 && (
                <FlyItem
                  icon={Trash2}
                  label={t('Clear notes and drawings')}
                  onClick={() => {
                    setFly(null)
                    if (confirm(t('Remove all {n} notes and drawings from this canvas? The nodes stay.', { n: marks.length }))) {
                      setMarks([])
                      setMarkSel(null)
                    }
                  }}
                />
              )}
            </div>
          )}
          {fly === 'templates' && (
            <div className="flow-fly flow-fly-wide" style={{ top: 80 }}>
              <p className="flow-fly-title">{t('Templates')}</p>
              {TEMPLATES.map((tp) => (
                <FlyItem key={tp.id} icon={LayoutTemplate} label={t(tp.label)} onClick={() => (loadTemplate(tp.id), setFly(null))} />
              ))}
            </div>
          )}
          {fly === 'shapes' && (
            <div className="flow-fly" style={{ top: 160 }}>
              <p className="flow-fly-title">{t('Shapes')}</p>
              {(
                [
                  ['rect', RectangleHorizontal, 'Rectangle', 'M'],
                  ['ellipse', Circle, 'Ellipse', 'L'],
                  ['line', Slash, 'Line', '\\'],
                  ['arrow', MoveUpRight, 'Arrow', 'Shift+\\'],
                ] as const
              ).map(([id, icon, label, keys]) => (
                <FlyItem key={id} on={tool === id} icon={icon} label={t(label)} keys={keys} onClick={() => ((lastShape.current = id), setTool(id), setFly(null))} />
              ))}
            </div>
          )}
          {fly === 'pen' && (
            <div className="flow-fly flow-ink" style={{ top: 200 }}>
              <div className="flow-ink-row">
                {SIZES.map((s) => (
                  <button key={s} className={ink.size === s ? 'active' : ''} onClick={() => setInk((v) => ({ ...v, size: s }))} aria-label={t('Stroke {n} px', { n: s })} title={t('Stroke {n} px', { n: s })}>
                    <i style={{ height: s }} />
                  </button>
                ))}
              </div>
              <div className="flow-ink-row">
                {INKS.map((c) => (
                  <button key={c} className={`flow-ink-dot ${ink.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setInk((v) => ({ ...v, color: c }))} aria-label={t('Color {c}', { c })} />
                ))}
                <label className="flow-ink-dot flow-ink-custom" title={t('Any color')}>
                  <input type="color" value={ink.color} onChange={(e) => setInk((v) => ({ ...v, color: e.target.value }))} aria-label={t('Any color')} />
                </label>
              </div>
            </div>
          )}
          {fly === 'media' && (
            <div className="flow-fly flow-fly-wide" style={{ top: 240 }}>
              <p className="flow-fly-title">{t('Add media')}</p>
              <FlyItem icon={Upload} label={t('Upload photos, videos or audio…')} onClick={() => (setFly(null), onUpload(undefined, 'any'))} />
              <FlyItem icon={ImageIcon} label={t('Image from your library')} onClick={() => (setFly(null), addNode('load'))} />
              <FlyItem icon={Clapperboard} label={t('Video from your library')} onClick={() => (setFly(null), addNode('loadvideo'))} />
              <FlyItem icon={FileAudio} label={t('Audio from your library')} onClick={() => (setFly(null), addNode('loadaudio'))} />
              <p className="flow-fly-note">{t('Tip: drop files straight on the canvas.')}</p>
            </div>
          )}
        </div>

        {libOpen && (
          <aside className="flow-lib" onPointerDown={(e) => e.stopPropagation()}>
            <p className="flow-lib-title">{t('Add a node')}</p>
            {['Text', 'Image', 'Video', 'Audio', 'Output', 'Other'].map((g) => (
              <div key={g}>
                <p className="flow-lib-group">{t(g)}</p>
                {libItems
                  .filter((d) => d.group === g)
                  .map((d) => {
                    const Icon = d.icon
                    return (
                      <button key={d.kind} className="flow-lib-item" onClick={() => addNode(d.kind)} style={{ ['--node-color' as string]: d.color }}>
                        <span className="flow-node-icon">
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0">
                          <strong>{t(d.title)}</strong>
                          <small>{t(d.hint)}</small>
                        </span>
                      </button>
                    )
                  })}
              </div>
            ))}
          </aside>
        )}

        {quickAdd && (
          <div className="flow-quick" style={{ left: quickAdd.sx, top: quickAdd.sy }} onPointerDown={(e) => e.stopPropagation()}>
            <label className="orbi-field">
              <Search size={13} />
              <input
                autoFocus
                value={quickAdd.q}
                placeholder={t('Search nodes')}
                onChange={(e) => setQuickAdd({ ...quickAdd, q: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickItems[0]) {
                    addNode(quickItems[0].kind, { x: quickAdd.wx, y: quickAdd.wy })
                    setQuickAdd(null)
                  }
                  if (e.key === 'Escape') setQuickAdd(null)
                }}
              />
            </label>
            {quickItems.map((d) => {
              const Icon = d.icon
              return (
                <button
                  key={d.kind}
                  onClick={() => {
                    addNode(d.kind, { x: quickAdd.wx, y: quickAdd.wy })
                    setQuickAdd(null)
                  }}
                >
                  <Icon size={13} /> {t(d.title)}
                </button>
              )
            })}
          </div>
        )}

        <div className="flow-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => setView((v) => ({ ...v, z: Math.max(ZOOM_MIN, v.z * 0.9) }))} aria-label={t('Zoom out')}>
            <Minus size={13} />
          </button>
          <span className="num">{Math.round(view.z * 100)}%</span>
          <button onClick={() => setView((v) => ({ ...v, z: Math.min(ZOOM_MAX, v.z * 1.1) }))} aria-label={t('Zoom in')}>
            <Plus size={13} />
          </button>
          <button onClick={fit} aria-label={t('Fit to screen')} title={t('Fit to screen')}>
            <Maximize size={13} />
          </button>
        </div>
        {!nodes.length && loaded && (
          <div className="flow-empty">
            <p>{t('Empty canvas')}</p>
            <span>{t('Start from a template or double-click to add a node.')}</span>
            <div className="flex flex-wrap justify-center gap-2">
              {TEMPLATES.map((tp) => (
                <button key={tp.id} className="orbi-btn" onClick={() => loadTemplate(tp.id)}>
                  {t(tp.label)}
                </button>
              ))}
            </div>
          </div>
        )}
        {toast && <div className="flow-toast">{toast}</div>}
        {maskFor && inputImageOf(maskFor) && (
          <MaskPainter
            imageUrl={inputImageOf(maskFor)!}
            onClose={() => setMaskFor(null)}
            onSave={(mask) => {
              setData(maskFor, { mask })
              setMaskFor(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

type Choice = { key: string; label: string }

function RailButton({ icon: Icon, label, active, more, onClick }: { icon: LucideIcon; label: string; active?: boolean; more?: boolean; onClick: () => void }) {
  return (
    <button className={`flow-rail-btn ${active ? 'active' : ''} ${more ? 'more' : ''}`} onClick={onClick} title={label} aria-label={label} aria-pressed={!!active}>
      <Icon size={17} />
    </button>
  )
}
function FlyItem({ icon: Icon, label, keys, on, onClick }: { icon: LucideIcon; label: string; keys?: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`flow-fly-item ${on ? 'active' : ''}`} onClick={onClick}>
      <span className="flow-fly-check">{on ? <Check size={13} /> : null}</span>
      <Icon size={15} />
      <span className="flex-1">{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
}

// Compact option chips for node settings (single choice, or several with `multi`).
function FlowChips({ label, options, value, onChange, multi = false }: { label?: string; options: readonly string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  return (
    <div className="flow-chips">
      {label && <span className="flow-chips-label">{label}</span>}
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button key={o} aria-pressed={on} className={on ? 'active' : ''} onClick={() => onChange(on ? value.filter((x) => x !== o) : multi ? [...value, o] : [o])}>
            {t(o)}
          </button>
        )
      })}
    </div>
  )
}

// ▶ next to a voice: the free stored sample of that voice (see lib/audioPrompt sampleText).
function VoicePreview({ model, voice }: { model: string; voice: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const player = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => player.current?.pause(), [])
  const play = async () => {
    if (state === 'playing') {
      player.current?.pause()
      return setState('idle')
    }
    const key = `${model}|${voice}`
    try {
      let url = sampleCache.get(key)
      if (!url) {
        setState('loading')
        url = await api.cloudSpeak({ text: sampleText(voice), model, voice })
        sampleCache.set(key, url)
      }
      player.current = new Audio(url)
      player.current.onended = () => setState('idle')
      setState('playing')
      await player.current.play()
    } catch {
      setState('idle')
    }
  }
  return (
    <button className="orbi-btn flow-play" onClick={play} title={t('Listen to {voice}', { voice: voiceName(voice) })} aria-label={t('Listen to {voice}', { voice: voiceName(voice) })}>
      {state === 'loading' ? <Loader2 size={12} className="animate-spin" /> : state === 'playing' ? <Square size={11} /> : <Play size={12} />}
    </button>
  )
}

type Extra = {
  vectorChoices: Choice[]
  onUpload: (nodeId: string, kind: 'image' | 'video' | 'audio') => void
  editChoices: Choice[]
  localImageChoices: Choice[]
  upscalers: Choice[]
  ttsVoices: Choice[]
  onPaintMask: () => void
  hasInputImage: boolean
  localStatus: LocalStatus | null
  models: ModelInfo[]
  promptContext: (id: string) => { mode: 'image' | 'video'; positive: string }
  catalog: CloudCatalog | null
  admin: boolean
}

// Orbi Cloud voice node value: 'cloud:<model>#<voice>'.
function parseCloudVoice(raw: unknown, catalog: CloudCatalog | null) {
  const s = String(raw || '')
  const [model, voice] = s.startsWith('cloud:') ? s.slice(6).split('#') : ['', '']
  const m = catalog?.tts.find((x) => x.id === model) ?? catalog?.tts[0]
  return { model: m?.id || '', voice: m && m.voices.includes(voice) ? voice : m?.voices[0] || '', spec: m }
}

// Voice node value: 'local:<model>#<voice>' (offline) or 'openai:<voice>'.
function parseVoice(raw: unknown, local: Choice[]): { type: 'local'; modelId: string; voice?: string | number } | { type: 'openai'; voice: string } | { type: 'native'; id: string; name: string } {
  const s = String(raw || (local[0] ? `local:${local[0].key}` : 'openai:alloy'))
  if (s.startsWith('openai:')) return { type: 'openai', voice: s.slice(7) }
  if (s.startsWith('native:')) {
    const [id, name] = s.slice(7).split('|')
    return { type: 'native', id, name: name || id }
  }
  const [modelId, voice] = s.slice(6).split('#')
  return { type: 'local', modelId, voice: voice == null ? undefined : /^\d+$/.test(voice) ? Number(voice) : voice }
}

function NodeBody({
  n,
  setData,
  chatModels,
  imageChoices,
  videoChoices,
  media,
  boards,
  onOpenModels,
  extra,
}: {
  extra: Extra
  n: FNode
  setData: (d: FNode['data']) => void
  chatModels: ModelInfo[]
  imageChoices: { key: string; label: string }[]
  videoChoices: { key: string; label: string }[]
  media: MediaItem[]
  boards: Board[]
  onOpenModels: () => void
}) {
  const out = n.out
  // Orbi Cloud: every model picker is the shared one (search, companies, Top / Fast / Cheap, price).
  const cat = extra.catalog
  const mediaItems = (list: Choice[], kind: 'image' | 'video'): MenuItem[] =>
    list.map((c) => {
      const id = c.key.split('::').pop() || c.key
      const e = kind === 'video' ? cat?.video.find((v) => v.id === id) : cat?.image.find((v) => v.id === id)
      const usd = kind === 'video' ? (e as CloudCatalog['video'][number] | undefined)?.usdPerSecond : (e as CloudCatalog['image'][number] | undefined)?.usd
      return { key: c.key, name: c.label.replace(/ · [^·]*$/, '').replace(/^[^:]+:\s*/, ''), sub: id, group: e?.featured ? t('Popular') : vendorLabel(id.split('/')[0]), featured: e?.featured, usd, unit: kind === 'video' ? 's' : 'img' }
    })
  const imgIcon = <ImageIcon size={14} />
  // The aspect ratios the chosen model accepts.
  const nodeAspects = (kind: 'image' | 'video', key: string) => {
    if (!CLOUD_ONLY) return Object.keys(ASPECTS)
    const id = key.split('::').pop()
    const spec = kind === 'video' ? cat?.video.find((v) => v.id === id) : cat?.image.find((v) => v.id === id)
    return aspectsFor({ aspects: spec?.aspects } as CreativeOption)
  }
  const nodeUsd = (kind: 'image' | 'video', key: string) => {
    const id = key.split('::').pop()
    if (kind === 'image') return cat?.image.find((v) => v.id === id)?.usd
    const v = cat?.video.find((x) => x.id === id)
    const secs = (Number(n.data.frames) || 33) / (Number(n.data.fps) || 16)
    const per = v?.usdBySecond?.[`${Number(n.data.res) || 720}p`] ?? v?.usdPerSecond
    return per !== undefined ? per * nearestDuration(v?.durations ?? [5], Math.round(secs)) : undefined
  }
  const preview = out?.media ? (
    out.media.kind === 'video' ? (
      <video className="flow-preview" src={out.media.url} controls loop muted />
    ) : out.media.kind === 'audio' ? (
      <audio className="flow-audio" src={out.media.url} controls />
    ) : (
      <img className="flow-preview" src={out.media.url} alt={out.media.name} draggable={false} />
    )
  ) : null
  const missing = (label: string) => (
    <button className="flow-missing" onClick={onOpenModels}>
      {label}
    </button>
  )
  const imageSpec = (key: string) => cat?.image.find((v) => v.id === key.split('::').pop())
  // Nodes with a Negative input can switch it off without unwiring (ComfyUI-style bypass of one input).
  const negToggle = DEFS[n.kind].inputs.some((p) => p.id === 'negative') ? (
    <label className="studio-check flow-toggle">
      <input type="checkbox" checked={!n.data.negOff} onChange={(e) => setData({ negOff: e.target.checked ? undefined : 1 })} /> {t('Use the negative prompt')}
    </label>
  ) : null
  // Each video model's own options: durations, resolutions, aspect ratios and native audio.
  const videoParams = (key: string, withAspect = true) => {
    const spec = cat?.video.find((v) => v.id === key.split('::').pop())
    if (!spec) return null
    const durations = spec.durations ?? [5]
    const duration = nearestDuration(durations, Number(n.data.duration) || Math.round((Number(n.data.frames) || 81) / (Number(n.data.fps) || 16)))
    const resolutions = spec.resolutions ?? ['720p']
    const res = resolutions.includes(String(n.data.resolution)) ? String(n.data.resolution) : nearestRes(resolutions, Number(n.data.res) || 720)
    return (
      <>
        {withAspect && (
          <label className="flow-row flow-label">
            <span>{t('Aspect ratio')}</span>
            <select className="ab-input" value={nearestAspect(spec.aspects?.length ? spec.aspects : ['16:9'], String(n.data.aspect || '16:9'))} onChange={(e) => setData({ aspect: e.target.value })}>
              {(spec.aspects?.length ? spec.aspects : ['16:9']).map((a) => (
                <option key={a} value={a}>
                  {a} · {t(aspectInfo(a).name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flow-row">
          <select className="ab-input num" value={duration} onChange={(e) => setData({ duration: Number(e.target.value) })} aria-label={t('Duration')}>
            {durations.map((d) => (
              <option key={d} value={d}>
                {t('{n} s', { n: d })}
              </option>
            ))}
          </select>
          <select className="ab-input" value={res} onChange={(e) => setData({ resolution: e.target.value })} aria-label={t('Resolution')}>
            {resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {spec.audio && (
          <label className="studio-check flow-toggle">
            <input type="checkbox" checked={n.data.audio !== 0} onChange={(e) => setData({ audio: e.target.checked ? 1 : 0 })} /> {t('Generate sound')}
          </label>
        )}
      </>
    )
  }
  switch (n.kind) {
    case 'prompt':
    case 'negative': {
      const ctx = extra.promptContext(n.id)
      const text = String(n.data.text || '')
      return (
        <>
          <PromptTools
            small
            target={n.kind === 'negative' ? 'negative' : 'prompt'}
            models={extra.models}
            mode={ctx.mode}
            prompt={n.kind === 'negative' ? ctx.positive : text}
            negative={n.kind === 'negative' ? text : ''}
            onChange={(r) => setData({ text: n.kind === 'negative' ? r.negative : r.prompt })}
          />
          <textarea
            className={`flow-text ${n.kind === 'negative' ? 'flow-negative' : ''}`}
            rows={n.kind === 'negative' ? 3 : 4}
            value={text}
            placeholder={n.kind === 'negative' ? t('What to avoid: blurry, watermark, extra fingers…') : t('Describe what you want…')}
            onChange={(e) => setData({ text: e.target.value })}
          />
        </>
      )
    }
    case 'note':
      return <textarea className="flow-text flow-note" rows={3} value={String(n.data.text || '')} placeholder={t('Write a note…')} onChange={(e) => setData({ text: e.target.value })} />
    case 'llm':
      return (
        <>
          {CLOUD_ONLY ? (
            <ModelSelect items={chatItems(chatModels, cat)} value={String(n.data.model || chatModels[0]?.key || '')} onPick={(k) => setData({ model: k })} />
          ) : (
            <select className="ab-input" value={String(n.data.model || chatModels[0]?.key || '')} onChange={(e) => setData({ model: e.target.value })}>
              {!chatModels.length && <option value="">{t('No chat model connected')}</option>}
              {chatModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} · {m.providerName}
                </option>
              ))}
            </select>
          )}
          <select className="ab-input" value={String(n.data.preset || 'image')} onChange={(e) => setData({ preset: e.target.value })}>
            {Object.entries(PRESETS).map(([k, p]) => (
              <option key={k} value={k}>
                {t(p.label)}
              </option>
            ))}
          </select>
          {n.data.preset === 'custom' && <textarea className="flow-text" rows={2} value={String(n.data.instruction || '')} placeholder={t('What should the AI do with the text?')} onChange={(e) => setData({ instruction: e.target.value })} />}
          {out?.text && <div className="flow-output-text flow-node-body-scroll">{out.text}</div>}
        </>
      )
    case 'image':
      return (
        <>
          {imageChoices.length && CLOUD_ONLY ? (
            <>
              <ModelSelect items={mediaItems(imageChoices, 'image')} value={String(n.data.model || imageChoices[0].key)} onPick={(k) => setData({ model: k })} icon={imgIcon} />
              <CostChip usd={nodeUsd('image', String(n.data.model || imageChoices[0].key))} className="flow-cost" />
            </>
          ) : imageChoices.length ? (
            <select className="ab-input" value={String(n.data.model || imageChoices[0].key)} onChange={(e) => setData({ model: e.target.value })}>
              {imageChoices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            missing(t('Download an image model'))
          )}
          <div className="flow-row">
            <select className="ab-input" value={String(n.data.aspect || '1:1')} onChange={(e) => setData({ aspect: e.target.value })} aria-label={t('Aspect')}>
              {nodeAspects('image', String(n.data.model || imageChoices[0]?.key || '')).map((a) => (
                <option key={a} value={a}>
                  {a} · {t(aspectInfo(a).name)}
                </option>
              ))}
            </select>
            {CLOUD_ONLY ? (
              !!imageSpec(String(n.data.model || imageChoices[0]?.key || ''))?.resolutions?.length && (
                <select className="ab-input" value={String(n.data.resolution || '')} onChange={(e) => setData({ resolution: e.target.value })} aria-label={t('Resolution')}>
                  <option value="">{t('Default size')}</option>
                  {imageSpec(String(n.data.model || imageChoices[0]?.key || ''))!.resolutions!.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )
            ) : (
              <>
                <input className="ab-input num" type="number" min={0} max={50} value={Number(n.data.steps) || 0} onChange={(e) => setData({ steps: Number(e.target.value) })} title={t('Steps (0 = model default)')} />
                <input className="ab-input num" placeholder={t('Seed')} value={String(n.data.seed ?? '')} onChange={(e) => setData({ seed: e.target.value.replace(/\D/g, '') })} title={t('Empty = random')} />
              </>
            )}
          </div>
          {negToggle}
          {preview}
        </>
      )
    case 'vector': {
      const list = extra.vectorChoices
      return (
        <>
          {list.length ? (
            <>
              <ModelSelect items={mediaItems(list, 'image')} value={String(n.data.model || list[0].key)} onPick={(k) => setData({ model: k })} icon={<PenTool size={14} />} />
              <CostChip usd={nodeUsd('image', String(n.data.model || list[0].key))} className="flow-cost" />
            </>
          ) : (
            <p className="flow-hint-text">{t('No vector model is available right now.')}</p>
          )}
          <select className="ab-input" value={String(n.data.aspect || '1:1')} onChange={(e) => setData({ aspect: e.target.value })} aria-label={t('Aspect')}>
            {nodeAspects('image', String(n.data.model || list[0]?.key || '')).map((a) => (
              <option key={a} value={a}>
                {a} · {t(aspectInfo(a).name)}
              </option>
            ))}
          </select>
          <p className="flow-hint-text">{t('Saved as SVG: scale it to any size or edit it in Illustrator or Figma.')}</p>
          {preview}
        </>
      )
    }
    case 'recompose': {
      const list = extra.editChoices
      const key = String(n.data.model || pickBest(list, BEST.edit) || list[0]?.key || '')
      const spec = imageSpec(key)
      return (
        <>
          {list.length ? (
            <>
              <ModelSelect items={mediaItems(list, 'image')} value={key} onPick={(k) => setData({ model: k })} icon={imgIcon} />
              <CostChip usd={nodeUsd('image', key)} className="flow-cost" />
            </>
          ) : null}
          <div className="flow-row">
            <select className="ab-input" value={String(n.data.aspect || '16:9')} onChange={(e) => setData({ aspect: e.target.value })} aria-label={t('New format')}>
              {nodeAspects('image', key).map((a) => (
                <option key={a} value={a}>
                  {a} · {t(aspectInfo(a).name)}
                </option>
              ))}
            </select>
            {!!spec?.resolutions?.length && (
              <select className="ab-input" value={String(n.data.resolution || '')} onChange={(e) => setData({ resolution: e.target.value })} aria-label={t('Resolution')}>
                <option value="">{t('Default size')}</option>
                {spec.resolutions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="flow-hint-text">{t('Extends the scene and re-lays out text, logo and hero image for the new format, without stretching.')}</p>
          {preview}
        </>
      )
    }
    case 'extend': {
      const key = String(n.data.model || pickBest(videoChoices, BEST.video) || videoChoices[0]?.key || '')
      return (
        <>
          {videoChoices.length ? (
            <>
              <ModelSelect items={mediaItems(videoChoices, 'video')} value={key} onPick={(k) => setData({ model: k })} icon={<Film size={14} />} />
              <CostChip usd={nodeUsd('video', key)} className="flow-cost" />
            </>
          ) : null}
          {videoParams(key)}
          {negToggle}
          <p className="flow-hint-text">{t('Only the new shot is generated; it starts from the last frame of the connected video.')}</p>
          {preview}
        </>
      )
    }
    case 'music': {
      const list = cat?.music ?? []
      const mm = list.find((x) => x.id === n.data.model) ?? list[0]
      const full = !!mm && !(mm.seconds && mm.seconds <= 30)
      const vocals = String(n.data.vocals || 'Instrumental')
      return (
        <>
          {list.length ? (
            <ModelSelect items={list.map((m) => ({ key: m.id, name: m.name.replace(/^[^:]+:\s*/, ''), sub: m.seconds && m.seconds <= 30 ? t('30-second clip') : t('full song'), group: 'Google · Lyria', usd: m.usd, unit: 'song' }))} value={mm?.id} onPick={(k) => setData({ model: k })} icon={<Music size={14} />} />
          ) : (
            <p className="flow-hint-text">{t('No music model is available right now.')}</p>
          )}
          <textarea className="flow-text" rows={2} value={String(n.data.text || '')} placeholder={t('Describe the music (or connect a prompt)')} onChange={(e) => setData({ text: e.target.value })} />
          <FlowChips label={t('Style')} options={GENRES} value={splitList(n.data.genres)} multi onChange={(v) => setData({ genres: v.join('|') })} />
          <FlowChips label={t('Mood')} options={MOODS} value={splitList(n.data.moods)} multi onChange={(v) => setData({ moods: v.join('|') })} />
          <label className="flow-row flow-label">
            <span>{t('Tempo')}</span>
            <input className="audio-range" type="range" min={0} max={180} step={5} value={Number(n.data.bpm) || 0} onChange={(e) => setData({ bpm: Number(e.target.value) < 60 ? 0 : Number(e.target.value) })} aria-label={t('Tempo')} />
            <em className="num">{Number(n.data.bpm) ? `${n.data.bpm}` : t('auto')}</em>
          </label>
          <FlowChips label={t('Vocals')} options={VOCALS} value={[vocals]} onChange={(v) => setData({ vocals: v[0] || 'Instrumental' })} />
          {vocals !== 'Instrumental' && <FlowChips label={t('Language of the lyrics')} options={LANGUAGES} value={[String(n.data.language || 'Any language')]} onChange={(v) => setData({ language: v[0] || 'Any language' })} />}
          {full && <FlowChips label={t('Length')} options={['Model decides', '~1 min', '~2 min', '~3 min']} value={[Number(n.data.length) ? `~${Number(n.data.length) / 60} min` : 'Model decides']} onChange={(v) => setData({ length: !v[0] || v[0] === 'Model decides' ? 0 : Number(v[0].replace(/\D/g, '')) * 60 })} />}
          {vocals !== 'Instrumental' && <textarea className="flow-text" rows={3} value={String(n.data.lyrics || '')} placeholder={t('Lyrics, with [Verse] [Chorus]… (or connect them)')} onChange={(e) => setData({ lyrics: e.target.value })} />}
          {preview}
        </>
      )
    }
    case 'sfx': {
      const list = cat?.sfx ?? []
      return (
        <>
          {list.length > 1 && <ModelSelect items={audioItems(list, 'k')} value={String(n.data.model || list[0].id)} onPick={(k) => setData({ model: k })} icon={<Waves size={14} />} />}
          <label className="flow-row flow-label">
            <span>{t('Duration')}</span>
            <input className="audio-range" type="range" min={1} max={20} value={Number(n.data.seconds) || 5} onChange={(e) => setData({ seconds: Number(e.target.value) })} aria-label={t('Duration')} />
            <em className="num">{t('{n} s', { n: Number(n.data.seconds) || 5 })}</em>
          </label>
          <FlowChips label={t('Intensity')} options={INTENSITY} value={[String(n.data.intensity || 'Medium')]} onChange={(v) => setData({ intensity: v[0] || 'Medium' })} />
          <FlowChips label={t('Space')} options={SPACES} value={n.data.space ? [String(n.data.space)] : []} onChange={(v) => setData({ space: v[0] || '' })} />
          <label className="studio-check">
            <input type="checkbox" checked={!!n.data.loop} onChange={(e) => setData({ loop: e.target.checked ? 1 : 0 })} /> {t('Seamless loop')}
          </label>
          {preview}
        </>
      )
    }
    case 'video':
      return (
        <>
          {videoChoices.length && CLOUD_ONLY ? (
            <>
              <ModelSelect items={mediaItems(videoChoices, 'video')} value={String(n.data.model || videoChoices[0].key)} onPick={(k) => setData({ model: k })} icon={<Film size={14} />} />
              <CostChip usd={nodeUsd('video', String(n.data.model || videoChoices[0].key))} className="flow-cost" />
            </>
          ) : videoChoices.length ? (
            <select className="ab-input" value={String(n.data.model || videoChoices[0].key)} onChange={(e) => setData({ model: e.target.value })}>
              {videoChoices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            missing(t('Download a video model'))
          )}
          {CLOUD_ONLY && (
            <label className="flow-row flow-label">
              <span>{t('Aspect ratio')}</span>
              <select className="ab-input" value={nearestAspect(nodeAspects('video', String(n.data.model || videoChoices[0]?.key || '')), String(n.data.aspect || '16:9'))} onChange={(e) => setData({ aspect: e.target.value })}>
                {nodeAspects('video', String(n.data.model || videoChoices[0]?.key || '')).map((a) => (
                  <option key={a} value={a}>
                    {a} · {t(aspectInfo(a).name)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {CLOUD_ONLY ? (
            videoParams(String(n.data.model || videoChoices[0]?.key || ''), false)
          ) : (
            <>
              <label className="flow-row flow-label">
                <span>{t('Frames')}</span>
                <input className="ab-input num" type="number" min={5} max={241} step={4} value={Number(n.data.frames) || 33} onChange={(e) => setData({ frames: Number(e.target.value) })} />
              </label>
              <label className="flow-row flow-label">
                <span>FPS</span>
                <select className="ab-input" value={Number(n.data.fps) || 16} onChange={(e) => setData({ fps: Number(e.target.value) })}>
                  {[8, 12, 16, 24, 30, 60].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <p className="flow-hint-text num">{t('≈ {s} s of video', { s: ((Number(n.data.frames) || 33) / (Number(n.data.fps) || 16)).toFixed(1) })}</p>
            </>
          )}
          {negToggle}
          {preview}
        </>
      )
    case 'load':
    case 'loadvideo':
    case 'loadaudio': {
      const want = n.kind === 'load' ? 'image' : n.kind === 'loadvideo' ? 'video' : 'audio'
      const q = String(n.data.q || '').toLowerCase()
      const items = media.filter((m) => m.kind === want && (!q || `${m.prompt || ''} ${m.name} ${m.model || ''}`.toLowerCase().includes(q))).slice(0, 90)
      const current = media.find((m) => m.id === n.data.mediaId)
      return (
        <>
          <label className="orbi-field flow-search">
            <Search size={12} />
            <input value={String(n.data.q || '')} onChange={(e) => setData({ q: e.target.value })} placeholder={t('Search your library')} aria-label={t('Search your library')} />
          </label>
          {items.length ? (
            want === 'audio' ? (
              <div className="flow-audio-list flow-node-body-scroll">
                {items.map((m) => (
                  <button key={m.id} className={m.id === n.data.mediaId ? 'active' : ''} onClick={() => setData({ mediaId: m.id })} title={m.prompt || m.name}>
                    <FileAudio size={12} /> <span className="truncate">{m.prompt || m.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flow-picker flow-node-body-scroll">
                {items.map((m) => (
                  <button key={m.id} className={m.id === n.data.mediaId ? 'active' : ''} onClick={() => setData({ mediaId: m.id })} title={m.prompt || m.name}>
                    {want === 'video' ? <video src={m.url} muted preload="metadata" /> : <img src={m.url} alt={m.name} loading="lazy" draggable={false} />}
                  </button>
                ))}
              </div>
            )
          ) : (
            <p className="flow-hint-text">{q ? t('Nothing matches this search.') : t('Nothing here yet — upload a file or drop it on the canvas.')}</p>
          )}
          <button className="flow-missing flow-upload" onClick={() => extra.onUpload(n.id, want)} title={t('Upload a file from this computer')}>
            <Upload size={13} /> {want === 'image' ? t('Image from this computer') : want === 'video' ? t('Video from this computer') : t('Audio from this computer')}
          </button>
          {current?.kind === 'image' && <img className="flow-preview" src={current.url} alt={current.name} draggable={false} />}
          {current?.kind === 'video' && <video className="flow-preview" src={current.url} controls loop muted />}
          {current?.kind === 'audio' && <audio className="flow-audio" src={current.url} controls />}
        </>
      )
    }
    case 'edit':
    case 'inpaint': {
      const list = n.kind === 'edit' || CLOUD_ONLY ? extra.editChoices : extra.localImageChoices
      return (
        <>
          {list.length && CLOUD_ONLY ? (
            <>
              <ModelSelect items={mediaItems(list, 'image')} value={String(n.data.model || list[0].key)} onPick={(k) => setData({ model: k })} icon={imgIcon} />
              <CostChip usd={nodeUsd('image', String(n.data.model || list[0].key))} className="flow-cost" />
            </>
          ) : list.length ? (
            <select className="ab-input" value={String(n.data.model || list[0].key)} onChange={(e) => setData({ model: e.target.value })}>
              {list.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            missing(n.kind === 'edit' ? t('Download an image editing model') : t('Download an image model'))
          )}
          {n.kind === 'inpaint' && (
            <>
              <button className="flow-missing" onClick={extra.onPaintMask} disabled={!extra.hasInputImage} title={extra.hasInputImage ? '' : t('Run the node that feeds the image first.')}>
                <Paintbrush size={12} className="inline" /> {n.data.mask ? t('Edit mask') : t('Paint mask')}
              </button>
              {!CLOUD_ONLY && (
                <label className="flow-row flow-label">
                  <span>{t('Change')}</span>
                  <input className="ab-input num" type="number" min={0.1} max={1} step={0.05} value={Number(n.data.strength) || 0.85} onChange={(e) => setData({ strength: Number(e.target.value) })} />
                </label>
              )}
            </>
          )}
          {negToggle}
          {preview}
        </>
      )
    }
    case 'upscale':
      return (
        <>
          {extra.upscalers.length && CLOUD_ONLY ? (
            <>
              <ModelSelect items={mediaItems(extra.upscalers, 'image')} value={String(n.data.model || extra.upscalers[0].key)} onPick={(k) => setData({ model: k })} icon={imgIcon} />
              <CostChip usd={nodeUsd('image', String(n.data.model || extra.upscalers[0].key))} className="flow-cost" />
            </>
          ) : extra.upscalers.length ? (
            <select className="ab-input" value={String(n.data.model || extra.upscalers[0].key)} onChange={(e) => setData({ model: e.target.value })}>
              {extra.upscalers.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            missing(t('Download an upscaler'))
          )}
          {preview}
        </>
      )
    case 'voice': {
      if (CLOUD_ONLY) {
        const cv = parseCloudVoice(n.data.voice, extra.catalog)
        return (
          <>
            <ModelSelect items={audioItems(extra.catalog?.tts ?? [], 'k')} value={cv.model} onPick={(k) => setData({ voice: `cloud:${k}#${extra.catalog?.tts.find((x) => x.id === k)?.voices[0] || ''}` })} icon={<Volume2 size={14} />} />
            {!!cv.spec?.voices.length && (
              <div className="flow-row">
                <select className="ab-input" value={cv.voice} onChange={(e) => setData({ voice: `cloud:${cv.model}#${e.target.value}` })}>
                  {cv.spec.voices.map((x) => (
                    <option key={x} value={x}>
                      {voiceName(x)}
                    </option>
                  ))}
                </select>
                <VoicePreview model={cv.model} voice={cv.voice} />
              </div>
            )}
            {takesStyle(cv.model) && (
              <>
                <input className="ab-input" value={String(n.data.style || '')} onChange={(e) => setData({ style: e.target.value })} placeholder={t('Delivery: tone, pace, emotion')} maxLength={300} />
                <FlowChips options={STYLES} value={n.data.style ? [String(n.data.style)] : []} onChange={(v) => setData({ style: v[0] || '' })} />
              </>
            )}
            {preview}
          </>
        )
      }
      const v = parseVoice(n.data.voice, extra.ttsVoices)
      const value: TtsChoice | null = v.type === 'local' ? { type: 'local', modelId: v.modelId, voice: v.voice, rate: 1 } : v.type === 'native' ? { type: 'native', id: v.id, name: v.name, rate: 1 } : null
      return (
        <>
          <VoiceButton
            status={extra.localStatus}
            onLocalChanged={() => {}}
            value={value}
            hideSystem
            label={v.type === 'openai' ? `OpenAI · ${v.voice}` : undefined}
            onPick={(c) => {
              if (c.type === 'native') setData({ voice: `native:${c.id}|${c.name}` })
              else if (c.type === 'cloud') setData({ voice: `openai:${c.voice}` })
              else if (c.type !== 'system') setData({ voice: `local:${c.modelId}${c.voice != null ? `#${c.voice}` : ''}` })
            }}
            extra={
              <div className="voice-option">
                <div className="voice-option-head">
                  <strong>{t('OpenAI (key needed)')}</strong>
                </div>
                {VOICES.map((o) => (
                  <div key={o} className={`voice-model ${v.type === 'openai' && v.voice === o ? 'active' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <strong>{o}</strong>
                    </div>
                    <button className={`orbi-btn ${v.type === 'openai' && v.voice === o ? 'orbi-btn-primary' : ''}`} onClick={() => setData({ voice: `openai:${o}` })}>
                      {v.type === 'openai' && v.voice === o ? t('Chosen') : t('Use')}
                    </button>
                  </div>
                ))}
              </div>
            }
          />
          {preview}
        </>
      )
    }
    case 'output':
      return (
        <>
          <select className="ab-input" value={String(n.data.board || '')} onChange={(e) => setData({ board: e.target.value })}>
            <option value="">{t('All media (no board)')}</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {preview || <p className="flow-hint-text">{t('Results appear here.')}</p>}
        </>
      )
  }
}

// Paint the area to repaint (white) over the input image; saved as a black/white mask at the image size.
function MaskPainter({ imageUrl, onSave, onClose }: { imageUrl: string; onSave: (mask: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [brush, setBrush] = useState(40)
  useEffect(() => {
    const im = new Image()
    im.onload = () => setSize({ w: im.naturalWidth, h: im.naturalHeight })
    im.src = imageUrl
  }, [imageUrl])
  const draw = (e: RPointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const ctx = c.getContext('2d')!
    const r = c.getBoundingClientRect()
    const at = (ev: { clientX: number; clientY: number }) => ({ x: ((ev.clientX - r.left) / r.width) * c.width, y: ((ev.clientY - r.top) / r.height) * c.height })
    const k = c.width / r.width
    let last = at(e)
    ctx.strokeStyle = ctx.fillStyle = '#ffffff'
    ctx.lineWidth = brush * k
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = e.button === 2 || e.altKey ? 'destination-out' : 'source-over'
    ctx.beginPath()
    ctx.arc(last.x, last.y, (brush * k) / 2, 0, Math.PI * 2)
    ctx.fill()
    c.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const p = at(ev)
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      last = p
    }
    const up = () => {
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
    }
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
  }
  const save = () => {
    const c = canvasRef.current
    if (!c) return
    const out = document.createElement('canvas')
    out.width = c.width
    out.height = c.height
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(c, 0, 0)
    onSave(out.toDataURL('image/png'))
  }
  return (
    <div className="orbi-modal-backdrop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mask-painter" role="dialog" aria-label={t('Paint mask')}>
        <div className="flex items-center justify-between gap-3">
          <strong>{t('Paint the area to change')}</strong>
          <label className="studio-brush">
            <span className="num">{brush}px</span>
            <input type="range" min={6} max={160} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
          </label>
        </div>
        <div className="mask-stage">
          {size && (
            <div className="mask-frame" style={(() => {
              const k = Math.min(860 / size.w, (window.innerHeight * 0.66) / size.h, 1.5)
              return { width: size.w * k, height: size.h * k }
            })()}>
              <img src={imageUrl} alt="" draggable={false} />
              <canvas ref={canvasRef} width={size.w} height={size.h} onPointerDown={draw} onContextMenu={(e) => e.preventDefault()} />
            </div>
          )}
        </div>
        <p className="flow-hint-text">{t('Paint with the mouse · right-click or Alt to erase')}</p>
        <div className="flex justify-end gap-2">
          <button className="orbi-btn" onClick={() => canvasRef.current?.getContext('2d')!.clearRect(0, 0, 99999, 99999)}>
            {t('Clear')}
          </button>
          <button className="orbi-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="orbi-btn orbi-btn-primary" onClick={save}>
            {t('Use this mask')}
          </button>
        </div>
      </div>
    </div>
  )
}
