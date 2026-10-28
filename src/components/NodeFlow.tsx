// Node workflows in the spirit of ComfyUI: typed ports, drag a wire from an output to an input,
// and every node really runs (text AI, image and video generation, voiceover, save to board).
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  AudioLines,
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
} from 'lucide-react'
import { api, on, type Board, type LocalStatus, type MediaItem, type ModelInfo, type TtsChoice } from '../lib/api'
import { VoiceButton } from './VoiceLibrary'
import { getLang, t } from '../lib/i18n'
import { activity } from '../lib/activity'
import { importComfy } from '../lib/comfy'

// ---------- types ----------
type PortType = 'text' | 'image' | 'video' | 'audio' | 'media'
type Kind = 'prompt' | 'llm' | 'image' | 'video' | 'load' | 'edit' | 'inpaint' | 'upscale' | 'voice' | 'output' | 'note'
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
type Port = { id: string; label: string; type: PortType; optional?: boolean }
type Def = { title: string; hint: string; icon: LucideIcon; color: string; group: string; inputs: Port[]; outputs: Port[]; data: () => FNode['data'] }

const DEFS: Record<Kind, Def> = {
  prompt: { title: 'Prompt', hint: 'Write the idea or brief', icon: FileText, color: '#9a7db0', group: 'Text', inputs: [], outputs: [{ id: 'text', label: 'Text', type: 'text' }], data: () => ({ text: '' }) },
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
    ],
    outputs: [{ id: 'video', label: 'Video', type: 'video' }],
    data: () => ({ frames: 33 }),
  },
  edit: {
    title: 'Edit image',
    hint: 'Change an image with words (FLUX.2 klein)',
    icon: WandSparkles,
    color: '#6f8fe0',
    group: 'Image',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'prompt', label: 'What to change', type: 'text' },
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
  load: { title: 'Load image', hint: 'Use an image from your library', icon: FolderInput, color: '#7aa36b', group: 'Image', inputs: [], outputs: [{ id: 'image', label: 'Image', type: 'image' }], data: () => ({}) },
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
const VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']

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
  if (id === 'text-image') {
    const p = n('prompt', 80, 140, { text: 'A cozy coffee shop on a rainy evening, warm light, cinematic' })
    const i = n('image', 430, 100)
    const o = n('output', 780, 140)
    return { nodes: [p, i, o], edges: [e(p, 'text', i, 'prompt'), e(i, 'image', o, 'media')] }
  }
  if (id === 'idea-image') {
    const p = n('prompt', 60, 160, { text: 'Poster for a jazz night in São Paulo' })
    const l = n('llm', 390, 120, { preset: 'image' })
    const i = n('image', 740, 100)
    const o = n('output', 1090, 140)
    return { nodes: [p, l, i, o], edges: [e(p, 'text', l, 'text'), e(l, 'text', i, 'prompt'), e(i, 'image', o, 'media')] }
  }
  if (id === 'image-video') {
    const ld = n('load', 80, 80)
    const p = n('prompt', 80, 340, { text: 'Slow camera push-in, gentle wind, cinematic motion' })
    const v = n('video', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [ld, p, v, o], edges: [e(ld, 'image', v, 'image'), e(p, 'text', v, 'prompt'), e(v, 'video', o, 'media')] }
  }
  if (id === 'edit') {
    const ld = n('load', 80, 100)
    const p = n('prompt', 80, 380, { text: 'Make it a snowy winter evening, keep the subject the same' })
    const ed = n('edit', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [ld, p, ed, o], edges: [e(ld, 'image', ed, 'image'), e(p, 'text', ed, 'prompt'), e(ed, 'image', o, 'media')] }
  }
  if (id === 'inpaint') {
    const ld = n('load', 80, 100)
    const p = n('prompt', 80, 380, { text: 'a vase of red flowers' })
    const ip = n('inpaint', 440, 160)
    const o = n('output', 800, 200)
    return { nodes: [ld, p, ip, o], edges: [e(ld, 'image', ip, 'image'), e(p, 'text', ip, 'prompt'), e(ip, 'image', o, 'media')] }
  }
  if (id === 'upscale') {
    const p = n('prompt', 60, 160, { text: 'Detailed portrait of an astronaut, studio light' })
    const i = n('image', 400, 100)
    const up = n('upscale', 760, 140)
    const o = n('output', 1110, 160)
    return { nodes: [p, i, up, o], edges: [e(p, 'text', i, 'prompt'), e(i, 'image', up, 'image'), e(up, 'image', o, 'media')] }
  }
  // campaign
  const p = n('prompt', 40, 260, { text: 'Launch of a minimalist smartwatch: calm, premium, soft light' })
  const l1 = n('llm', 370, 80, { preset: 'image' })
  const i = n('image', 720, 40)
  const l2 = n('llm', 370, 470, { preset: 'script' })
  const vo = n('voice', 720, 500)
  const v = n('video', 1070, 120)
  const o = n('output', 1420, 260)
  return {
    nodes: [p, l1, i, l2, vo, v, o],
    edges: [e(p, 'text', l1, 'text'), e(l1, 'text', i, 'prompt'), e(i, 'image', v, 'image'), e(l1, 'text', v, 'prompt'), e(p, 'text', l2, 'text'), e(l2, 'text', vo, 'text'), e(v, 'video', o, 'media'), e(vo, 'audio', o, 'media'), e(i, 'image', o, 'media')],
  }
}
const TEMPLATES = [
  { id: 'text-image', label: 'Text → image' },
  { id: 'idea-image', label: 'Idea → AI prompt → image' },
  { id: 'image-video', label: 'Image → video' },
  { id: 'edit', label: 'Edit an image with words' },
  { id: 'inpaint', label: 'Inpaint: repaint one area' },
  { id: 'upscale', label: 'Generate and upscale 4×' },
  { id: 'campaign', label: 'Campaign: image, video and voiceover' },
]

export function NodeFlow({ models, localStatus, onMediaCreated, onOpenModels, visible = true }: { models: ModelInfo[]; localStatus: LocalStatus | null; onMediaCreated: (m: MediaItem) => void; onOpenModels: () => void; visible?: boolean }) {
  const [nodes, setNodes] = useState<FNode[]>([])
  const [edges, setEdges] = useState<FEdge[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, z: 0.9 })
  const [wire, setWire] = useState<null | { from: string; fromPort: string; type: PortType; x: number; y: number }>(null)
  const [quickAdd, setQuickAdd] = useState<null | { sx: number; sy: number; wx: number; wy: number; q: string }>(null)
  const [libOpen, setLibOpen] = useState(false)
  const [running, setRunning] = useState(false)
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
      ...(localStatus?.models.filter((m) => m.kind === 'image' && m.installed).map((m) => ({ key: `local::${m.id}`, label: `${m.name} · ${t('this PC')}` })) ?? []),
      ...models.filter((m) => m.image).map((m) => ({ key: `cloud::${m.key}`, label: `${m.name} · ${m.providerName}` })),
    ],
    [models, localStatus],
  )
  const editChoices = useMemo(() => localStatus?.models.filter((m) => m.kind === 'image' && m.installed && m.gen?.ref).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])
  const localImageChoices = useMemo(() => localStatus?.models.filter((m) => m.kind === 'image' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])
  const ttsVoices = useMemo(() => localStatus?.models.filter((m) => m.kind === 'tts' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])
  const upscalers = useMemo(() => localStatus?.models.filter((m) => m.kind === 'upscale' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])
  const [maskFor, setMaskFor] = useState<string | null>(null)
  const inputImageOf = (id: string) => {
    const e = edges.find((x) => x.to === id && x.toPort === 'image')
    const src = e ? nodes.find((x) => x.id === e.from) : undefined
    const m = src?.out?.media || (src?.kind === 'load' ? media.find((x) => x.id === src.data.mediaId) : undefined)
    return m && m.kind === 'image' ? m.url : null
  }
  const videoChoices = useMemo(() => localStatus?.models.filter((m) => m.kind === 'video' && m.installed).map((m) => ({ key: m.id, label: m.name })) ?? [], [localStatus])

  // load / save
  useEffect(() => {
    api.getWorkflow('flow').then((w) => {
      const saved = w as null | { nodes?: FNode[]; edges?: FEdge[]; view?: typeof view }
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
    const tm = setTimeout(() => api.saveWorkflow('flow', 'Workflow', { nodes: nodes.map((n) => ({ ...n, progress: undefined })), edges, view }), 600)
    return () => clearTimeout(tm)
  }, [nodes, edges, view, loaded])
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
  const loadTemplate = (id: string) => {
    if (nodesRef.current.length > 1 && !confirm(t('Replace the current workflow with this template?'))) return
    const tpl = template(id)
    setNodes(tpl.nodes)
    setEdges(tpl.edges)
    setView({ x: 40, y: 40, z: 0.85 })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, select')) return
      if (!stageRef.current?.isConnected) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeNode(selected)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected) {
        e.preventDefault()
        duplicate(selected)
      }
      if (e.key === 'Escape') {
        setWire(null)
        setQuickAdd(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // ---------- pointer: pan, zoom, drag, wires ----------
  const onStageDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('flow-world')) return
    setSelected(null)
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
    if ((e.target as HTMLElement).closest('textarea, select, .flow-node-body-scroll')) return
    const r = stageRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    setView((v) => {
      const z = Math.min(1.8, Math.max(0.3, v.z * (e.deltaY < 0 ? 1.1 : 0.9)))
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
  const fit = () => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || !nodes.length) return
    const minX = Math.min(...nodes.map((n) => n.x))
    const minY = Math.min(...nodes.map((n) => n.y))
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W))
    const maxY = Math.max(...nodes.map((n) => n.y + 320))
    const z = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY))))
    setView({ z, x: 40 - minX * z + (r.width - 80 - (maxX - minX) * z) / 2, y: 40 - minY * z })
  }

  // ---------- execution ----------
  const inputsOf = (id: string) => edgesRef.current.filter((e) => e.to === id)
  const withMediaLock = <T,>(fn: () => Promise<T>) => {
    const p = mediaLock.current.then(fn, fn)
    mediaLock.current = p.catch(() => {})
    return p
  }

  const execNode = async (n: FNode, ins: Record<string, Val[]>): Promise<Val> => {
    const firstText = (k: string) => ins[k]?.map((v) => v.text).filter(Boolean).join('\n\n') || ''
    const firstMedia = (k: string) => ins[k]?.find((v) => v.media)?.media
    switch (n.kind) {
      case 'prompt':
      case 'note':
        return { text: String(n.data.text || '') }
      case 'load': {
        const m = media.find((x) => x.id === n.data.mediaId)
        if (!m) throw new Error(t('Pick an image from your library.'))
        return { media: { id: m.id, url: m.url, name: m.name, kind: m.kind } }
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
        const [w0, h0] = ASPECTS[String(n.data.aspect || '1:1')] || [1, 1]
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
                negative: n.data.negative ? String(n.data.negative) : undefined,
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
            return await api.generateImage({ providerId: m.provider, model: m.id, prompt, width, height, source: 'creative' })
          } finally {
            activeMediaNode.current = null
          }
        })
        onMediaCreated(item)
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
            return await api.generateLocal({ jobId: jobFor(n.id), modelId, prompt, frames: Number(n.data.frames) || 33, fps: Number(n.data.fps) || undefined, initImage, seed: Math.floor(Math.random() * 2 ** 31) })
          } finally {
            activeMediaNode.current = null
          }
        })
        onMediaCreated(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'edit':
      case 'inpaint': {
        const img = firstMedia('image')
        if (!img || img.kind !== 'image') throw new Error(t('Connect an image to this node.'))
        const prompt = firstText('prompt')
        if (!prompt) throw new Error(t('Connect a prompt to this node.'))
        const list = n.kind === 'edit' ? editChoices : localImageChoices
        const modelId = String(n.data.model || list[0]?.key || '')
        if (!modelId) throw new Error(n.kind === 'edit' ? t('Image editing needs FLUX.2 klein 4B — download it in Models.') : t('No image model yet — download one in Models or connect a provider.'))
        if (n.kind === 'inpaint' && !n.data.mask) throw new Error(t('Paint the area to change first (Paint mask).'))
        const dataUrl = (await api.mediaDataUrl(img.id)) || undefined
        const size = await new Promise<{ w: number; h: number }>((ok) => {
          const im = new Image()
          im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight })
          im.onerror = () => ok({ w: 768, h: 768 })
          im.src = img.url
        })
        const scaleTo = Math.min(1, 1024 / Math.max(size.w, size.h))
        const item = await withMediaLock(() =>
          api.generateLocal({
            jobId: jobFor(n.id),
            modelId,
            prompt,
            width: snap64(size.w * scaleTo),
            height: snap64(size.h * scaleTo),
            ...(n.kind === 'edit' ? { refImages: dataUrl ? [dataUrl] : [] } : { initImage: dataUrl, mask: String(n.data.mask), strength: Number(n.data.strength) || 0.85 }),
            seed: Math.floor(Math.random() * 2 ** 31),
          }),
        )
        onMediaCreated(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'upscale': {
        const img = firstMedia('image')
        if (!img || img.kind !== 'image') throw new Error(t('Connect an image to this node.'))
        if (!upscalers.length) throw new Error(t('Download an upscaler in Models (Image → Upscalers).'))
        const item = await withMediaLock(() => api.upscale({ mediaId: img.id, modelId: String(n.data.model || upscalers[0].key), jobId: jobFor(n.id) }))
        onMediaCreated(item)
        return { media: { id: item.id, url: item.url, name: item.name, kind: item.kind } }
      }
      case 'voice': {
        const text = firstText('text')
        if (!text) throw new Error(t('Connect a script to this node.'))
        const v = parseVoice(n.data.voice, ttsVoices)
        const item = v.type === 'local' ? await api.speakToMedia({ text, modelId: v.modelId, voice: v.voice, lang: getLang() }) : await api.speech({ text, voice: v.voice })
        onMediaCreated(item)
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
    const act = activity.start({ area: 'creative', kind: 'workflow', label: `${t('Workflow')} · ${t(DEFS[n?.kind || 'image'].title)}` })
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
    const act = activity.start({ area: 'creative', kind: 'workflow', label: t('Workflow') })
    const memo = new Map<string, Promise<Val | undefined>>()
    const ends = nodesRef.current.filter((n) => n.kind !== 'note' && !edgesRef.current.some((e) => e.from === n.id))
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
        setEdges(r.edges)
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
        <button className={`orbi-btn ${libOpen ? 'orbi-btn-soft' : ''}`} onClick={() => setLibOpen((v) => !v)}>
          <Plus size={13} /> {t('Nodes')}
        </button>
        <label className="flow-select">
          <LayoutTemplate size={13} />
          <select value="" onChange={(e) => e.target.value && loadTemplate(e.target.value)} aria-label={t('Templates')}>
            <option value="">{t('Templates…')}</option>
            {TEMPLATES.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {t(tp.label)}
              </option>
            ))}
          </select>
        </label>
        <button className="orbi-btn" onClick={() => fileRef.current?.click()} title={t('Open an Orbi or ComfyUI workflow (.json)')}>
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
        <span className="flow-hint">{t('Drag from a ● output to an input · double-click the canvas to add · scroll to zoom')}</span>
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
        className="flow-stage"
        ref={stageRef}
        onPointerDown={onStageDown}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('flow-world')) return
          const r = stageRef.current!.getBoundingClientRect()
          const w = toWorld(e.clientX, e.clientY)
          setQuickAdd({ sx: e.clientX - r.left, sy: e.clientY - r.top, wx: w.x, wy: w.y, q: '' })
        }}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${22 * view.z}px ${22 * view.z}px` }}
      >
        <div className="flow-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
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
                    extra={{ editChoices, localImageChoices, upscalers, ttsVoices, onPaintMask: () => setMaskFor(n.id), hasInputImage: !!inputImageOf(n.id), localStatus }}
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
          <button onClick={() => setView((v) => ({ ...v, z: Math.max(0.3, v.z * 0.9) }))} aria-label={t('Zoom out')}>
            <Minus size={13} />
          </button>
          <span className="num">{Math.round(view.z * 100)}%</span>
          <button onClick={() => setView((v) => ({ ...v, z: Math.min(1.8, v.z * 1.1) }))} aria-label={t('Zoom in')}>
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
type Extra = { editChoices: Choice[]; localImageChoices: Choice[]; upscalers: Choice[]; ttsVoices: Choice[]; onPaintMask: () => void; hasInputImage: boolean; localStatus: LocalStatus | null }

// Voice node value: 'local:<model>#<voice>' (offline) or 'openai:<voice>'.
function parseVoice(raw: unknown, local: Choice[]): { type: 'local'; modelId: string; voice?: string | number } | { type: 'openai'; voice: string } {
  const s = String(raw || (local[0] ? `local:${local[0].key}` : 'openai:alloy'))
  if (s.startsWith('openai:')) return { type: 'openai', voice: s.slice(7) }
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
  switch (n.kind) {
    case 'prompt':
    case 'note':
      return (
        <textarea
          className={`flow-text ${n.kind === 'note' ? 'flow-note' : ''}`}
          rows={n.kind === 'note' ? 3 : 4}
          value={String(n.data.text || '')}
          placeholder={n.kind === 'note' ? t('Write a note…') : t('Describe what you want…')}
          onChange={(e) => setData({ text: e.target.value })}
        />
      )
    case 'llm':
      return (
        <>
          <select className="ab-input" value={String(n.data.model || chatModels[0]?.key || '')} onChange={(e) => setData({ model: e.target.value })}>
            {!chatModels.length && <option value="">{t('No chat model connected')}</option>}
            {chatModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} · {m.providerName}
              </option>
            ))}
          </select>
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
          {imageChoices.length ? (
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
              {Object.keys(ASPECTS).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input className="ab-input num" type="number" min={0} max={50} value={Number(n.data.steps) || 0} onChange={(e) => setData({ steps: Number(e.target.value) })} title={t('Steps (0 = model default)')} />
            <input className="ab-input num" placeholder={t('Seed')} value={String(n.data.seed ?? '')} onChange={(e) => setData({ seed: e.target.value.replace(/\D/g, '') })} title={t('Empty = random')} />
          </div>
          {preview}
        </>
      )
    case 'video':
      return (
        <>
          {videoChoices.length ? (
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
          {preview}
        </>
      )
    case 'load': {
      const images = media.filter((m) => m.kind === 'image').slice(0, 60)
      const current = images.find((m) => m.id === n.data.mediaId)
      return (
        <>
          {images.length ? (
            <div className="flow-picker flow-node-body-scroll">
              {images.map((m) => (
                <button key={m.id} className={m.id === n.data.mediaId ? 'active' : ''} onClick={() => setData({ mediaId: m.id })} title={m.prompt || m.name}>
                  <img src={m.url} alt={m.name} loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          ) : (
            <p className="flow-hint-text">{t('Your library is empty — generate or import images first.')}</p>
          )}
          {current && <img className="flow-preview" src={current.url} alt={current.name} draggable={false} />}
        </>
      )
    }
    case 'edit':
    case 'inpaint': {
      const list = n.kind === 'edit' ? extra.editChoices : extra.localImageChoices
      return (
        <>
          {list.length ? (
            <select className="ab-input" value={String(n.data.model || list[0].key)} onChange={(e) => setData({ model: e.target.value })}>
              {list.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            missing(n.kind === 'edit' ? t('Download FLUX.2 klein 4B to edit images') : t('Download an image model'))
          )}
          {n.kind === 'inpaint' && (
            <>
              <button className="flow-missing" onClick={extra.onPaintMask} disabled={!extra.hasInputImage} title={extra.hasInputImage ? '' : t('Run the node that feeds the image first.')}>
                <Paintbrush size={12} className="inline" /> {n.data.mask ? t('Edit mask') : t('Paint mask')}
              </button>
              <label className="flow-row flow-label">
                <span>{t('Change')}</span>
                <input className="ab-input num" type="number" min={0.1} max={1} step={0.05} value={Number(n.data.strength) || 0.85} onChange={(e) => setData({ strength: Number(e.target.value) })} />
              </label>
            </>
          )}
          {preview}
        </>
      )
    }
    case 'upscale':
      return (
        <>
          {extra.upscalers.length ? (
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
      const v = parseVoice(n.data.voice, extra.ttsVoices)
      const value: TtsChoice | null = v.type === 'local' ? { type: 'local', modelId: v.modelId, voice: v.voice, rate: 1 } : null
      return (
        <>
          <VoiceButton
            status={extra.localStatus}
            onLocalChanged={() => {}}
            value={value}
            hideSystem
            label={v.type === 'openai' ? `OpenAI · ${v.voice}` : undefined}
            onPick={(c) => c.type !== 'system' && setData({ voice: `local:${c.modelId}${c.voice != null ? `#${c.voice}` : ''}` })}
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
