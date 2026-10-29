// Creative studio: Launchpad · Canvas · Workflows · Gallery.
// Left: what to make (Image or Video) with model-aware defaults. Center: canvas with live render status.
// Right: render queue, boards, gallery and layers. Renders keep running when you leave this screen.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import {
  Brush,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Dice5,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Loader2,
  Maximize,
  Maximize2,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Square,
  Trash2,
  Video,
  Wallet,
  Wand2,
  Workflow,
  X, RefreshCw } from 'lucide-react'
import { api, on, type Board, type LocalStatus, type MediaItem, type ModelInfo } from '../lib/api'
import { ASPECTS, CLOUD_GEN, creativeOptions, sizeFor, snap, type CreativeOption } from '../lib/creative'
import { creativeBus, takePendingUse, type GenRequest } from '../lib/creativeBus'
import { CLOUD_ONLY, fmtCredits, nearestDuration, nearestRes, useCloud } from '../lib/cloud'
import { resLabel, resolutionsFor } from '../lib/creative'
import { activity } from '../lib/activity'
import { fmtBytes, t } from '../lib/i18n'
import { ThemeSwitcher, type ThemeMode } from './ThemeSwitcher'
import { Lightbox } from './Lightbox'
import { PromptTools } from './PromptTools'
import { DEFAULT_NEGATIVE, IDEAS, IDEA_CATS, type Idea, type IdeaCat } from '../lib/ideas'

const NodeFlow = lazy(() => import('./NodeFlow').then((m) => ({ default: m.NodeFlow })))

type Tab = 'launchpad' | 'canvas' | 'workflows' | 'gallery'
type Mode = 'image' | 'video'
type Quality = 0 | 1 | 2 | 3 // fast, balanced, best, custom
type Option = CreativeOption
type Job = {
  id: string
  mode: Mode
  label: string
  prompt: string
  status: 'queued' | 'running' | 'done' | 'error'
  step?: number
  total?: number
  phase?: string
  started?: number
  ended?: number
  error?: string
  media?: MediaItem
  run: (jobId: string) => Promise<MediaItem>
  local: boolean
  /** Request id when the render was asked from the chat or the library. */
  origin?: string
  from?: 'chats'
}

const FPS = [8, 12, 16, 24, 30, 60]
const QUALITY = ['Fast', 'Balanced', 'Best', 'Custom'] as const

// Scales an image to cover width × height (centered crop), as the engines expect for a start frame.
async function coverTo(dataUrl: string, width: number, height: number) {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')!
  const s = Math.max(width / img.width, height / img.height)
  ctx.drawImage(img, (width - img.width * s) / 2, (height - img.height * s) / 2, img.width * s, img.height * s)
  return out.toDataURL('image/png')
}
const cleanErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const secs = (ms: number) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`)

function Section({ title, children, open: initial = true, right }: { title: string; children: React.ReactNode; open?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className={`studio-section ${open ? 'open' : ''}`}>
      <button className="studio-section-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{title}</span>
        {right}
        <ChevronDown size={13} className="studio-chev" />
      </button>
      {open && <div className="studio-section-body">{children}</div>}
    </section>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="studio-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="studio-num num" type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <em>{suffix}</em>}
    </label>
  )
}

export function CreativeStudio({
  themeMode,
  setThemeMode,
  onBack,
  models,
  localStatus,
  onOpenModels,
  onMediaCreated,
  visible = true,
}: {
  themeMode: ThemeMode
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>
  onBack: () => void
  models: ModelInfo[]
  localStatus: LocalStatus | null
  onOpenModels: () => void
  onMediaCreated: (m: MediaItem) => void
  visible?: boolean
}) {
  const [tab, setTab] = useState<Tab>('canvas')
  const [flowMounted, setFlowMounted] = useState(false)
  useEffect(() => {
    if (tab === 'workflows') setFlowMounted(true)
  }, [tab])
  const [media, setMedia] = useState<MediaItem[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [board, setBoard] = useState<string>('')
  const [newBoard, setNewBoard] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ list: MediaItem[]; index: number } | null>(null)
  const [ideaCat, setIdeaCat] = useState<IdeaCat | 'all'>('all')
  const [ideaQuery, setIdeaQuery] = useState('')
  const [flowTemplate, setFlowTemplate] = useState<{ id: string; prompt: string; negative: string } | null>(null)

  // what to make
  const [mode, setMode] = useState<Mode>('image')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [modelKeys, setModelKeys] = useState<Record<Mode, string>>({ image: '', video: '' })
  const [aspect, setAspect] = useState('1:1')
  const [size, setSize] = useState({ w: 768, h: 768 })
  const [quality, setQuality] = useState<Quality>(1)
  const [customSteps, setCustomSteps] = useState(20)
  const [seed, setSeed] = useState<number>(42)
  const [randomSeed, setRandomSeed] = useState(true)
  const [count, setCount] = useState(1)
  const [strength, setStrength] = useState(0.65)
  const [useInit, setUseInit] = useState(false)
  const [duration, setDuration] = useState(2)
  const [cloudRes, setCloudRes] = useState<Record<Mode, number>>({ image: 1024, video: 720 })
  const [audio, setAudio] = useState(true)
  const [fps, setFps] = useState(16)

  // canvas
  const [base, setBase] = useState<{ id?: string; dataUrl: string; name: string; kind: 'image' | 'video'; url?: string } | null>(null)
  const [baseVisible, setBaseVisible] = useState(true)
  const [maskVisible, setMaskVisible] = useState(true)
  const [maskDirty, setMaskDirty] = useState(false)
  const [tool, setTool] = useState<'brush' | 'eraser' | 'view'>('view')
  const [brush, setBrush] = useState(48)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 })

  // render queue
  const [jobs, setJobs] = useState<Job[]>([])
  const startedIds = useRef(new Set<string>())
  const [, tick] = useState(0)

  const hw = localStatus?.hardware
  const maxLocal = (hw?.vram ?? 0) >= 12 ? 2 : 1

  const loadMedia = useCallback(async () => {
    const [m, b] = await Promise.all([api.media(), api.boards()])
    setMedia(m)
    setBoards(b)
  }, [])
  useEffect(() => {
    loadMedia()
    api.getSetting('studioPrompt', '').then((v) => {
      if (v) {
        setPrompt(String(v))
        api.setSetting('studioPrompt', '')
      }
    })
    api.getSetting('studio2', null as null | Record<string, unknown>).then((s) => {
      if (!s) return
      if (s.modelKeys && typeof s.modelKeys === 'object') setModelKeys((c) => ({ ...c, ...(s.modelKeys as Record<Mode, string>) }))
      if (s.mode === 'video' || s.mode === 'image') setMode(s.mode)
      if (typeof s.aspect === 'string') setAspect(s.aspect)
      if (typeof s.quality === 'number') setQuality(s.quality as Quality)
      if (typeof s.fps === 'number') setFps(s.fps)
      if (typeof s.duration === 'number') setDuration(s.duration)
    })
  }, [])

  // "Use prompt" from the Media Library or another screen.
  useEffect(() => {
    const onUse = (e: Event) => {
      const d = (e as CustomEvent<{ prompt: string; negative?: string; mode?: Mode; initMediaId?: string }>).detail
      if (!d?.prompt && !d?.initMediaId) return
      takePendingUse()
      if (d.prompt) setPrompt(d.prompt)
      if (d.negative !== undefined) setNegative(d.negative)
      if (d.mode) setMode(d.mode)
      if (d.initMediaId)
        api.mediaDataUrl(d.initMediaId).then((dataUrl) => {
          if (!dataUrl) return
          setBase({ id: d.initMediaId, dataUrl, name: t('Start image'), kind: 'image' })
          setBaseVisible(true)
          setUseInit(true)
        })
      setTab('canvas')
      api.setSetting('studioPrompt', '')
    }
    window.addEventListener('orbi:use-prompt', onUse)
    const waiting = takePendingUse()
    if (waiting) onUse(new CustomEvent('orbi:use-prompt', { detail: waiting }))
    return () => window.removeEventListener('orbi:use-prompt', onUse)
  }, [])

  // live progress for each job
  useEffect(
    () =>
      on('local:progress', (p: { jobId?: string; step: number; total: number; phase?: string }) => {
        if (!p.jobId) return
        setJobs((cur) => cur.map((j) => (j.id === p.jobId ? { ...j, step: p.step || j.step, total: p.total || j.total, phase: p.phase || (p.total ? 'sampling' : j.phase) } : j)))
        if (p.total) activity.update(p.jobId, { progress: p.step / p.total })
      }),
    [],
  )
  // elapsed-time ticker while something renders
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'running')) return
    const tm = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(tm)
  }, [jobs])

  // ---------- models ----------
  const cloud = useCloud()
  const options: Option[] = useMemo(() => creativeOptions(localStatus, models, cloud.catalog), [localStatus, models, cloud.catalog])
  const modeOptions = options.filter((o) => o.kind === mode)
  const current = modeOptions.find((o) => o.key === modelKeys[mode]) ?? modeOptions[0]
  const gen = current?.gen ?? CLOUD_GEN
  // Cloud models: the provider sets steps and fps; you pick resolution, length and sound.
  const isCloud = !!current && !current.local
  const spec = current?.video
  const cloudResList = isCloud ? resolutionsFor(current, mode) : []
  const cloudShort = cloudResList.includes(cloudRes[mode]) ? cloudRes[mode] : cloudResList[Math.min(1, cloudResList.length - 1)] ?? 720
  const cloudDur = spec ? nearestDuration(spec.durations, duration) : duration
  const estimate = !isCloud ? null : spec ? (spec.pricePerSecond ? spec.pricePerSecond * cloudDur : null) : current?.price ? current.price * count : null
  const withAvoid = (p: string, neg?: string) => (neg && neg.trim() ? `${p}\n\nAvoid: ${neg.trim()}` : p)
  const cloudRender = (jobId: string, o: Option, r: { prompt: string; negative?: string; aspect: string; short: number; duration: number; init?: string; audio: boolean; source?: string }) =>
    o.video
      ? api.cloudVideo({
          jobId,
          model: o.modelId,
          prompt: withAvoid(r.prompt, r.negative),
          negative: r.negative,
          duration: nearestDuration(o.video.durations, r.duration),
          resolution: nearestRes(o.video.resolutions, r.short),
          aspect: o.video.aspects.includes(r.aspect) ? r.aspect : o.video.aspects[0],
          frameImage: r.init,
          audio: o.video.audio ? r.audio : undefined,
          board,
          source: r.source,
        })
      : api.generateImage({ providerId: o.providerId!, model: o.modelId, prompt: withAvoid(r.prompt, r.negative), board, ...((({ w, h }) => ({ width: w, height: h }))(sizeFor(r.aspect, 1024))), resolution: resLabel(r.short), refImages: r.init ? [r.init] : undefined, source: r.source || 'creative' })
  const steps = gen.fixedSteps ? gen.presets[0] : quality === 3 ? customSteps : gen.presets[quality]
  const frames = Math.max(5, Math.round((duration * fps) / 4) * 4 + 1)
  const width = size.w
  const height = size.h

  // Default size follows the model; on a PC without GPU, start smaller so it finishes in reasonable time.
  useEffect(() => {
    if (!current) return
    const cpuOnly = !hw?.gpuAccel
    const base = Math.min(gen.width, gen.height) || 768
    const target = cpuOnly && current.local ? Math.min(base, 512) : base
    const a = ASPECTS.find((x) => x.id === aspect) ?? ASPECTS[0]
    const area = mode === 'video' ? gen.width * gen.height : target * target
    const w = snap(Math.sqrt((area * a.w) / a.h))
    setSize({ w, h: snap((w * a.h) / a.w) })
    if (mode === 'video' && gen.fps && !FPS.includes(fps)) setFps(gen.fps)
  }, [current?.key, mode])

  useEffect(() => {
    api.setSetting('studio2', { modelKeys, mode, aspect, quality, fps, duration })
  }, [modelKeys, mode, aspect, quality, fps, duration])

  // How heavy this render is for this PC (never blocks — it only warns).
  const load = useMemo(() => {
    if (!current?.local) return null
    const px = (width * height) / (768 * 768)
    const work = mode === 'video' ? (frames / 33) * px * (steps / 20) : px * (steps / 8) * count
    const power = hw?.gpuAccel ? Math.max(1, (hw.vram || 2) / 4) : 0.25
    const score = work / power
    return score < 1.2 ? 'ok' : score < 3 ? 'heavy' : 'very-heavy'
  }, [current?.key, width, height, frames, steps, count, mode, hw])

  // ---------- canvas sizing ----------
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [tab])
  const scale = Math.min((stageSize.w - 48) / width, (stageSize.h - 48) / height, 1.5)

  const applyAspect = (id: string) => {
    setAspect(id)
    const a = ASPECTS.find((x) => x.id === id)
    if (!a) return
    const area = width * height
    const w = snap(Math.sqrt((area * a.w) / a.h))
    setSize({ w, h: snap((w * a.h) / a.w) })
  }

  // ---------- mask painting ----------
  useEffect(() => {
    const c = maskRef.current
    if (!c) return
    const prev = document.createElement('canvas')
    prev.width = c.width
    prev.height = c.height
    prev.getContext('2d')!.drawImage(c, 0, 0)
    c.width = width
    c.height = height
    c.getContext('2d')!.drawImage(prev, 0, 0, width, height)
  }, [width, height])

  const paint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'view') return
    const c = maskRef.current!
    const ctx = c.getContext('2d')!
    const rect = c.getBoundingClientRect()
    const toLocal = (ev: { clientX: number; clientY: number }) => ({ x: ((ev.clientX - rect.left) / rect.width) * c.width, y: ((ev.clientY - rect.top) / rect.height) * c.height })
    let last = toLocal(e)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brush
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(last.x, last.y, brush / 2, 0, Math.PI * 2)
    ctx.fill()
    c.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev)
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      last = p
    }
    const up = () => {
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      setMaskDirty(true)
      setUseInit(true)
    }
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
  }
  const clearMask = () => {
    const c = maskRef.current
    c?.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setMaskDirty(false)
  }
  const exportMask = () => {
    const c = maskRef.current
    if (!c || !maskDirty) return undefined
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(c, 0, 0)
    return out.toDataURL('image/png')
  }
  const exportInit = async () => {
    if (!base || base.kind !== 'image') return undefined
    const img = new Image()
    img.src = base.dataUrl
    await img.decode()
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    const s = Math.max(width / img.width, height / img.height)
    ctx.drawImage(img, (width - img.width * s) / 2, (height - img.height * s) / 2, img.width * s, img.height * s)
    return out.toDataURL('image/png')
  }
  const showInCanvas = async (m: MediaItem) => {
    if (m.kind === 'video') {
      setBase({ id: m.id, dataUrl: '', name: m.name, kind: 'video', url: m.url })
    } else if (m.kind === 'image') {
      const dataUrl = await api.mediaDataUrl(m.id)
      if (dataUrl) setBase({ id: m.id, dataUrl, name: m.name, kind: 'image', url: m.url })
    }
    setBaseVisible(true)
  }

  // ---------- queue ----------
  const patchJob = (id: string, p: Partial<Job>) => setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...p } : j)))
  useEffect(() => {
    const running = jobs.filter((j) => j.status === 'running')
    const runningLocal = running.filter((j) => j.local).length
    const next = jobs.find((j) => j.status === 'queued' && !startedIds.current.has(j.id) && (j.local ? runningLocal < maxLocal : running.length < 4))
    if (!next) return
    startedIds.current.add(next.id)
    patchJob(next.id, { status: 'running', started: Date.now(), phase: 'loading' })
    activity.start({ id: next.id, area: 'creative', kind: next.mode, label: next.label, from: next.from })
    next
      .run(next.id)
      .then(async (item) => {
        patchJob(next.id, { status: 'done', media: item, ended: Date.now() })
        onMediaCreated(item)
        setMedia((cur) => [item, ...cur])
        activity.end(next.id, { ok: true, message: next.mode === 'video' ? t('Your video is ready.') : t('Your image is ready.') })
        // Show the newest result unless the user is painting a mask.
        if (!maskDirty) showInCanvas(item)
      })
      .catch((e) => {
        const msg = cleanErr(e)
        const stopped = /stopped|abort|killed|SIGTERM/i.test(msg)
        patchJob(next.id, { status: 'error', error: stopped ? t('Stopped.') : msg, ended: Date.now() })
        activity.end(next.id, { ok: false, message: stopped ? t('Stopped.') : msg })
      })
  }, [jobs, maxLocal])

  const invokeNow = async () => {
    if (!current || !prompt.trim()) return
    const mask = maskDirty ? exportMask() : undefined
    const init = (useInit || mask) && base?.kind === 'image' ? await exportInit() : undefined
    const p = prompt.trim()
    const n = mode === 'video' ? 1 : count
    const created: Job[] = []
    for (let i = 0; i < n; i++) {
      const s = randomSeed ? Math.floor(Math.random() * 2 ** 31) : seed + i
      const label = `${mode === 'video' ? t('Video') : t('Image')}${n > 1 ? ` ${i + 1}/${n}` : ''} · ${current.label}`
      const run = (jobId: string) =>
        current.local
          ? api.generateLocal({
              jobId,
              modelId: current.modelId,
              prompt: p,
              negative: negative.trim() || undefined,
              width,
              height,
              steps: steps || undefined,
              seed: s,
              initImage: init,
              mask: init && mode === 'image' ? mask : undefined,
              strength,
              frames: mode === 'video' ? frames : undefined,
              fps: mode === 'video' ? fps : undefined,
              board,
            })
          : cloudRender(jobId, current, { prompt: p, negative: negative.trim() || undefined, aspect, short: cloudShort, duration: cloudDur, init, audio })
      created.push({ id: Math.random().toString(36).slice(2, 10), mode, label, prompt: p, status: 'queued', run, local: current.local })
    }
    setJobs((cur) => [...cur.filter((j) => j.status === 'queued' || j.status === 'running' || Date.now() - (j.ended || 0) < 10 * 60000).slice(-30), ...created])
  }
  const cancelJob = (j: Job) => {
    if (j.status === 'queued') setJobs((cur) => cur.filter((x) => x.id !== j.id))
    else if (!j.local && j.mode === 'video') api.cloudCancelVideo(j.id)
    else api.cancelLocalGenerate(j.id)
  }
  const upscale = (m: MediaItem) => {
    const id = Math.random().toString(36).slice(2, 10)
    setJobs((cur) => [...cur, { id, mode: 'image', label: `${t('Upscale 4×')} · ${m.name}`, prompt: m.prompt || m.name, status: 'queued', local: true, run: (jobId) => api.upscale({ mediaId: m.id, jobId, board }) }])
    setTab('canvas')
  }
  const hasUpscaler = !!localStatus?.models.some((m) => m.kind === 'upscale' && m.installed)

  // ---------- renders asked from the chat or the Media Library ----------
  const serveRef = useRef<(r: GenRequest) => void>(() => {})
  serveRef.current = async (r: GenRequest) => {
    const fail = (error: string) => creativeBus.emit({ id: r.id, status: 'error', error })
    try {
      if (r.mode === 'upscale') {
        if (!r.initMediaId) return fail(t('Pick an image first.'))
        if (!hasUpscaler) return fail(t('Download an upscaler in Models first (Real-ESRGAN).'))
        const id = Math.random().toString(36).slice(2, 10)
        setJobs((cur) => [...cur, { id, origin: r.id, from: r.source === 'chat' ? 'chats' : undefined, mode: 'image', label: t('Upscale 4×'), prompt: r.prompt, status: 'queued', local: true, run: (jobId) => api.upscale({ mediaId: r.initMediaId!, jobId, board }) }])
        return
      }
      const mode: Mode = r.mode
      const list = options.filter((o) => o.kind === mode)
      const o = list.find((x) => x.key === r.modelKey) ?? list.find((x) => x.key === modelKeys[mode]) ?? list[0]
      if (!o) return fail(mode === 'video' ? t('No video model is installed yet — open Models to download one.') : t('No image model is installed yet — open Models to download one.'))
      const g = o.gen ?? CLOUD_GEN
      const short = r.res || Math.min(g.width, g.height) || 768
      const { w, h } = sizeFor(r.aspect || '1:1', short)
      const stepsN = g.fixedSteps ? g.presets[0] : g.presets[1]
      const fpsN = g.fps || 16
      const framesN = Math.max(5, Math.round(((r.duration || 2) * fpsN) / 4) * 4 + 1)
      const src = r.initDataUrl || (r.initMediaId ? await api.mediaDataUrl(r.initMediaId) : null)
      const init = src ? await coverTo(src, w, h) : undefined
      const n = mode === 'video' ? 1 : Math.max(1, Math.min(4, r.count || 1))
      const created: Job[] = []
      for (let i = 0; i < n; i++) {
        const label = `${mode === 'video' ? t('Video') : t('Image')}${n > 1 ? ` ${i + 1}/${n}` : ''} · ${o.label}`
        const s = Math.floor(Math.random() * 2 ** 31)
        const run = (jobId: string) =>
          o.local
            ? api.generateLocal({ jobId, modelId: o.modelId, prompt: r.prompt, negative: r.negative?.trim() || undefined, width: w, height: h, steps: stepsN || undefined, seed: s, initImage: init, strength: init && mode === 'image' ? 0.65 : undefined, frames: mode === 'video' ? framesN : undefined, fps: mode === 'video' ? fpsN : undefined, board, source: r.source })
            : cloudRender(jobId, o, { prompt: r.prompt, negative: r.negative, aspect: r.aspect || '1:1', short: r.res || resolutionsFor(o, mode)[0], duration: r.duration || 5, init, audio: r.audio !== false, source: r.source })
        created.push({ id: Math.random().toString(36).slice(2, 10), origin: r.id, from: r.source === 'chat' ? 'chats' : undefined, mode, label, prompt: r.prompt, status: 'queued', run, local: o.local })
      }
      setJobs((cur) => [...cur, ...created])
    } catch (e) {
      fail(cleanErr(e))
    }
  }
  useEffect(() => creativeBus.serve((r) => serveRef.current(r)), [])
  // Report progress of those renders back to whoever asked.
  const reported = useRef(new Map<string, string>())
  useEffect(() => {
    const byOrigin = new Map<string, Job[]>()
    for (const j of jobs) if (j.origin) byOrigin.set(j.origin, [...(byOrigin.get(j.origin) ?? []), j])
    for (const [origin, list] of byOrigin) {
      const part = (j: Job) => (j.status === 'done' || j.status === 'error' ? 1 : j.status === 'running' && j.total ? (j.step || 0) / j.total : 0)
      const progress = list.reduce((a, j) => a + part(j), 0) / list.length
      const finished = list.every((j) => j.status === 'done' || j.status === 'error')
      const ok = list.filter((j) => j.status === 'done' && j.media).map((j) => j.media!)
      const status = finished ? (ok.length ? 'done' : 'error') : list.some((j) => j.status === 'running') ? 'running' : 'queued'
      const sig = `${status}:${Math.round(progress * 100)}:${ok.length}`
      if (reported.current.get(origin) === sig) continue
      reported.current.set(origin, sig)
      creativeBus.emit({ id: origin, status, progress, media: ok, total: list.length, error: status === 'error' ? list.find((j) => j.error)?.error : undefined })
    }
  }, [jobs])

  const [galleryQuery, setGalleryQuery] = useState('')
  const [galleryKind, setGalleryKind] = useState<'all' | 'image' | 'video'>('all')
  const gq = galleryQuery.trim().toLowerCase()
  const boardMedia = media.filter((m) => (m.kind === 'image' || m.kind === 'video') && (!board || m.board === board))
  const shownMedia = boardMedia.filter((m) => (galleryKind === 'all' || m.kind === galleryKind) && (!gq || `${m.prompt} ${m.name} ${m.model}`.toLowerCase().includes(gq)))
  const makeVideoFrom = (m: MediaItem) =>
    creativeBus.request({ id: Math.random().toString(36).slice(2, 10), mode: 'video', prompt: m.prompt || t('Gentle camera move, natural motion'), negative: DEFAULT_NEGATIVE.video, initMediaId: m.id, aspect: '16:9' })
  const editInCanvas = (m: MediaItem) => {
    showInCanvas(m)
    setMode('image')
    setTool('brush')
    setViewing(null)
    setTab('canvas')
  }
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running')
  const focusJob = jobs.filter((j) => j.status === 'running').slice(-1)[0]
  const tabs: { id: Tab; label: string; icon: typeof Rocket }[] = [
    { id: 'launchpad', label: 'Launchpad', icon: Rocket },
    { id: 'canvas', label: 'Canvas', icon: LayoutGrid },
    { id: 'workflows', label: 'Workflows', icon: Workflow },
    { id: 'gallery', label: 'Gallery', icon: Images },
  ]
  const localImage = options.filter((o) => o.local && o.kind === 'image').length
  const localVideo = options.filter((o) => o.local && o.kind === 'video').length

  const BoardsPanel = (
    <div className="studio-boards">
      <div className="studio-panel-head">
        <span>{t('Boards')}</span>
        <button className="panel-add" aria-label={t('New board')} onClick={() => setNewBoard('')}>
          <Plus size={13} />
        </button>
      </div>
      {newBoard !== null && (
        <input
          className="ab-input"
          autoFocus
          placeholder={t('Board name')}
          value={newBoard}
          onChange={(e) => setNewBoard(e.target.value)}
          onBlur={() => setNewBoard(null)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') setNewBoard(null)
            if (e.key === 'Enter' && newBoard.trim()) {
              const b = await api.createBoard(newBoard.trim())
              setNewBoard(null)
              setBoards((cur) => [...cur, b])
              setBoard(b.id)
            }
          }}
        />
      )}
      <div className="studio-board-list">
        <button className={board === '' ? 'active' : ''} onClick={() => setBoard('')}>
          <FolderOpen size={13} />
          <span>{t('All media')}</span>
          <em className="num">{media.filter((m) => m.kind === 'image' || m.kind === 'video').length}</em>
        </button>
        {boards.map((b) => (
          <button key={b.id} className={board === b.id ? 'active' : ''} onClick={() => setBoard(b.id)}>
            <FolderOpen size={13} />
            <span>{b.name}</span>
            <em className="num">{media.filter((m) => m.board === b.id).length}</em>
            <span
              role="button"
              className="studio-board-x"
              title={t('Delete board')}
              onClick={async (e) => {
                e.stopPropagation()
                if (!confirm(t('Delete board "{name}"? Its images stay in All media.', { name: b.name }))) return
                await api.deleteBoard(b.id)
                if (board === b.id) setBoard('')
                loadMedia()
              }}
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  const negativeOf = (m: MediaItem) => {
    try {
      return String((m.params && JSON.parse(m.params).negative) || '')
    } catch {
      return ''
    }
  }
  const usePromptOf = (m: MediaItem) => {
    setPrompt(m.prompt)
    const neg = negativeOf(m)
    if (neg) setNegative(neg)
    if (m.kind === 'video' || m.kind === 'image') setMode(m.kind)
    setTab('canvas')
  }
  const openViewer = (m: MediaItem) => {
    const i = shownMedia.findIndex((x) => x.id === m.id)
    setViewing({ list: shownMedia, index: Math.max(0, i) })
  }
  const useIdea = (idea: Idea) => {
    if (idea.mode === 'workflow') {
      setFlowTemplate({ id: idea.template || 'text-image', prompt: idea.prompt, negative: idea.negative || '' })
      setTab('workflows')
      return
    }
    setMode(idea.mode)
    setPrompt(idea.prompt)
    setNegative(idea.negative || DEFAULT_NEGATIVE[idea.mode])
    setUseInit(false)
    if (idea.aspect) applyAspect(idea.aspect)
    setTab('canvas')
  }
  // The newest render made from an idea becomes its cover.
  const coverOf = (idea: Idea) => media.find((m) => m.prompt === idea.prompt && (m.kind === 'image' || m.kind === 'video'))

  const Thumb = ({ m, big = false }: { m: MediaItem; big?: boolean }) => (
    <div className={`studio-thumb ${base?.id === m.id ? 'active' : ''} ${big ? 'big' : ''}`} title={m.prompt || m.name}>
      {m.kind === 'video' ? (
        <video src={m.url} muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} onClick={() => (big ? openViewer(m) : (showInCanvas(m), setTab('canvas')))} onDoubleClick={() => openViewer(m)} />
      ) : (
        <img src={m.url} alt={m.name} loading="lazy" onClick={() => (big ? openViewer(m) : (showInCanvas(m), setTab('canvas')))} onDoubleClick={() => openViewer(m)} />
      )}
      <span className={`studio-thumb-kind kind-${m.kind}`}>{m.kind === 'video' ? <Video size={10} /> : <ImageIcon size={10} />}</span>
      <div className="media-tile-tools">
        {m.kind === 'image' && (!CLOUD_ONLY || hasUpscaler) && (
          <button
            title={hasUpscaler ? t('Upscale 4×') : t('Download an upscaler in Models to enlarge images')}
            onClick={() => (hasUpscaler ? upscale(m) : onOpenModels())}
          >
            <Maximize2 size={12} />
          </button>
        )}
        <button title={t('View full screen')} onClick={() => openViewer(m)}>
          <Maximize size={12} />
        </button>
        {m.prompt && (
          <button title={t('Use prompt')} onClick={() => usePromptOf(m)}>
            <Wand2 size={12} />
          </button>
        )}
        <button title={t('Save as…')} onClick={() => api.saveMediaAs(m.id)}>
          <Download size={12} />
        </button>
        <button
          title={t('Delete')}
          onClick={async () => {
            if (!confirm(t('Delete this file from the library?'))) return
            await api.deleteMedia(m.id)
            if (base?.id === m.id) setBase(null)
            loadMedia()
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {big && boards.length > 0 && (
        <select className="studio-thumb-board" value={m.board || ''} onChange={async (e) => (await api.setMediaBoard(m.id, e.target.value), loadMedia())} aria-label={t('Move to board')}>
          <option value="">{t('No board')}</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )

  const jobStatus = (j: Job) =>
    j.status === 'queued'
      ? t('Waiting in line')
      : j.status === 'running'
        ? !j.local
          ? j.mode === 'video'
            ? j.phase === 'decoding'
              ? t('Downloading…')
              : j.phase === 'cloud'
                ? t('Rendering in the cloud…')
                : t('Waiting at the provider…')
            : t('Generating…')
          : j.total
          ? t('Step {s} of {n}', { s: j.step || 0, n: j.total })
          : j.phase === 'decoding'
            ? t('Finishing…')
            : j.phase === 'upscaling'
              ? t('Upscaling…')
              : t('Loading model…')
        : j.status === 'done'
          ? t('Done')
          : j.error || t('Failed')

  return (
    <main className="studio" style={visible ? undefined : { display: 'none' }}>
      <header className="studio-top">
        <div className="flex min-w-0 items-center gap-2">
          <button className="creative-topbar-button" onClick={onBack} aria-label={t('Back to chats')}>
            <ChevronLeft size={17} />
          </button>
          <span className="studio-title">{t('Creative')}</span>
          <nav className="studio-tabs" role="tablist">
            {tabs.map((x) => {
              const Icon = x.icon
              return (
                <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
                  <Icon size={14} />
                  {t(x.label)}
                  {x.id === 'canvas' && activeJobs.length > 0 && <span className="studio-tab-badge num">{activeJobs.length}</span>}
                </button>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {CLOUD_ONLY ? (
            <button className="orbi-btn" onClick={onOpenModels} title={t('Open your account')}>
              <Wallet size={13} /> <span className="num">{fmtCredits(cloud.state?.user?.credits.total ?? 0)}</span> {t('credits')}
            </button>
          ) : (
            <button className="orbi-btn" onClick={onOpenModels}>
              <Sparkles size={13} /> {t('Models')}
            </button>
          )}
          <ThemeSwitcher themeMode={themeMode} setThemeMode={setThemeMode} />
        </div>
      </header>

      {tab === 'launchpad' && (
        <div className="launchpad launchpad-v2">
          <nav className="launchpad-cats" aria-label={t('Idea categories')}>
            {IDEA_CATS.map((c) => (
              <button key={c.id} className={ideaCat === c.id ? 'active' : ''} onClick={() => setIdeaCat(c.id)}>
                {t(c.label)}
                <em className="num">{c.id === 'all' ? IDEAS.length : IDEAS.filter((x) => x.cat === c.id).length}</em>
              </button>
            ))}
            {CLOUD_ONLY ? (
            <div className="launchpad-status">
              <p>
                <strong>{t('Orbi Cloud')}</strong>
              </p>
              <ul>
                <li>
                  <span className={`mcp-dot ${cloud.state?.user ? 'mcp-dot-connected' : ''}`} /> {cloud.state?.user ? t('Signed in as {email}', { email: cloud.state.user.email }) : t('Not signed in')}
                </li>
                <li>
                  <span className={`mcp-dot ${options.some((o) => o.kind === 'image') ? 'mcp-dot-connected' : ''}`} /> {t('Image models')} · <span className="num">{options.filter((o) => o.kind === 'image').length}</span>
                </li>
                <li>
                  <span className={`mcp-dot ${options.some((o) => o.kind === 'video') ? 'mcp-dot-connected' : ''}`} /> {t('Video models')} · <span className="num">{options.filter((o) => o.kind === 'video').length}</span>
                </li>
                <li>
                  <span className="mcp-dot mcp-dot-connected" /> {t('Credits')} · <span className="num">{fmtCredits(cloud.state?.user?.credits.total ?? 0)}</span>
                </li>
              </ul>
              <button className="orbi-btn orbi-btn-primary mt-3" onClick={onOpenModels}>
                <Wallet size={13} /> {t('Plans and credits')}
              </button>
            </div>
            ) : (
            <div className="launchpad-status">
            <p>
              <strong>{t('Ready on this PC')}</strong>
            </p>
            <ul>
              <li>
                <span className={`mcp-dot ${localStatus?.engines.sd.installed ? 'mcp-dot-connected' : ''}`} /> {t('Image & video engine')} · {localStatus?.engines.sd.installed ? t('installed') : t('downloads with the first model')}
              </li>
              <li>
                <span className={`mcp-dot ${localImage ? 'mcp-dot-connected' : ''}`} /> {t('Image models')} · <span className="num">{localImage}</span>
              </li>
              <li>
                <span className={`mcp-dot ${localVideo ? 'mcp-dot-connected' : ''}`} /> {t('Video models')} · <span className="num">{localVideo}</span>
              </li>
              <li>
                <span className={`mcp-dot ${options.some((o) => !o.local) ? 'mcp-dot-connected' : ''}`} /> {t('Cloud image models')} · <span className="num">{options.filter((o) => !o.local).length}</span>
              </li>
            </ul>
            <button className="orbi-btn orbi-btn-primary mt-3" onClick={onOpenModels}>
              <Download size={13} /> {t('Get image & video models')}
            </button>
          </div>
            )}
          </nav>
          <div className="launchpad-main">
            <h2>{t('What do you want to create?')}</h2>
          <div className="launchpad-actions">
            <button
              onClick={() => {
                setMode('image')
                setUseInit(false)
                setTab('canvas')
              }}
            >
              <ImageIcon size={20} />
              <strong>{t('Generate an image')}</strong>
              <span>{t('Write a prompt, pick a size and invoke.')}</span>
            </button>
            <button
              onClick={() => {
                setMode('video')
                setTab('canvas')
              }}
            >
              <Video size={20} />
              <strong>{t('Generate a video')}</strong>
              <span>{CLOUD_ONLY ? t('Veo, Seedance, Wan and more — with sound.') : localVideo ? t('Short clips with Wan on this PC.') : t('Install a video model first.')}</span>
            </button>
            <button
              onClick={() => {
                setMode('image')
                setUseInit(true)
                setTool('brush')
                setTab('canvas')
              }}
            >
              <Brush size={20} />
              <strong>{t('Edit an image')}</strong>
              <span>{t('Load an image, paint a mask, change only that area.')}</span>
            </button>
            <button onClick={() => setTab('workflows')}>
              <Workflow size={20} />
              <strong>{t('Build a workflow')}</strong>
              <span>{t('Chain briefs, images and exports as nodes.')}</span>
            </button>
          </div>
            <div className="launchpad-ideas-head">
              <h3>{t(IDEA_CATS.find((c) => c.id === ideaCat)?.label || 'All ideas')}</h3>
              <label className="orbi-field launchpad-search">
                <Search size={13} />
                <input value={ideaQuery} onChange={(e) => setIdeaQuery(e.target.value)} placeholder={t('Search ideas')} />
              </label>
            </div>
            <div className="launchpad-grid">
              {IDEAS.filter((x) => (ideaCat === 'all' || x.cat === ideaCat) && `${x.title} ${t(x.title)} ${x.tags.join(' ')} ${x.prompt}`.toLowerCase().includes(ideaQuery.toLowerCase())).map((idea) => {
                const cover = coverOf(idea)
                return (
                  <button key={idea.id} className="idea-card" onClick={() => useIdea(idea)} title={idea.prompt}>
                    <div className="idea-cover" style={{ ['--h1' as string]: idea.hue[0], ['--h2' as string]: idea.hue[1] }}>
                      {cover ? cover.kind === 'video' ? <video src={cover.url} muted loop autoPlay playsInline /> : <img src={cover.url} alt="" loading="lazy" /> : <span className="idea-cover-text">{idea.prompt}</span>}
                      <span className="idea-kind">
                        {idea.mode === 'video' ? <Video size={11} /> : idea.mode === 'workflow' ? <Workflow size={11} /> : <ImageIcon size={11} />}
                        {idea.mode === 'video' ? t('Video') : idea.mode === 'workflow' ? t('Workflow') : t('Image')}
                      </span>
                    </div>
                    <strong>{t(idea.title)}</strong>
                    <span className="idea-tags">
                      {idea.tags.map((tag) => (
                        <em key={tag}>{t(tag)}</em>
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="studio-hint">{t('Click an idea to open it in the Canvas or as a workflow. The first image you make from an idea becomes its cover.')}</p>
          </div>
        </div>
      )}

      {tab === 'canvas' && (
        <div className="studio-body">
          <aside className="studio-left">
            <div className="studio-mode" role="tablist" aria-label={t('What to make')}>
              {(
                [
                  ['image', 'Image', ImageIcon],
                  ['video', 'Video', Video],
                ] as const
              ).map(([id, label, Icon]) => (
                <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>
                  <Icon size={14} /> {t(label)}
                </button>
              ))}
            </div>
            <div className="studio-scroll">
              <Section title={t('Prompt')}>
                <textarea
                  className="studio-prompt"
                  rows={5}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={mode === 'video' ? t('Describe the scene, the action and the camera movement…') : t('Describe the image…')}
                  onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && invokeNow()}
                />
                <PromptTools
                  models={models}
                  mode={mode}
                  prompt={prompt}
                  negative={negative}
                  onChange={(r) => {
                    setPrompt(r.prompt)
                    setNegative(r.negative)
                  }}
                />
                <div className="studio-prompt-label">
                  <span>{t('Negative prompt')}</span>
                </div>
                <textarea className="studio-prompt studio-negative" rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder={t('Negative prompt (what to avoid)')} />
              </Section>
              <Section title={t('Model')}>
                {!modeOptions.length ? (
                  CLOUD_ONLY ? (
                    <div className="studio-empty">
                      <p>{cloud.state?.user ? t('The models did not load from Orbi Cloud. Check your internet and try again.') : t('Sign in to your Orbi account to see the models.')}</p>
                      <button className="orbi-btn orbi-btn-primary" onClick={() => (cloud.state?.user ? cloud.refresh() : onOpenModels())}>
                        <RefreshCw size={13} /> {cloud.state?.user ? t('Try again') : t('Open your account')}
                      </button>
                    </div>
                  ) : (
                    <div className="studio-empty">
                      <p>{mode === 'video' ? t('No video model yet.') : t('No image models yet.')}</p>
                      <button className="orbi-btn orbi-btn-primary" onClick={onOpenModels}>
                        <Download size={13} /> {t('Get a model')}
                      </button>
                    </div>
                  )
                ) : (
                  <select className="ab-input" value={current?.key} onChange={(e) => setModelKeys((c) => ({ ...c, [mode]: e.target.value }))}>
                    {[...new Set(modeOptions.map((o) => o.group))].map((g) => (
                      <optgroup key={g} label={g}>
                        {modeOptions
                          .filter((o) => o.group === g)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </Section>
              {isCloud ? (
                <Section title={t('Size')}>
                  <div className="studio-aspects">
                    {ASPECTS.filter((a) => !spec || spec.aspects.includes(a.id)).map((a) => (
                      <button key={a.id} className={aspect === a.id ? 'active' : ''} onClick={() => applyAspect(a.id)}>
                        <i style={{ aspectRatio: `${a.w}/${a.h}` }} />
                        {a.id}
                      </button>
                    ))}
                  </div>
                  <div className="studio-count">
                    <span>{t('Resolution')}</span>
                    {cloudResList.map((r) => (
                      <button key={r} className={cloudShort === r ? 'active' : ''} onClick={() => setCloudRes((c) => ({ ...c, [mode]: r }))}>
                        {resLabel(r)}
                      </button>
                    ))}
                  </div>
                </Section>
              ) : (
              <Section title={t('Size')}>
                <div className="studio-aspects">
                  {ASPECTS.map((a) => (
                    <button key={a.id} className={aspect === a.id ? 'active' : ''} onClick={() => applyAspect(a.id)}>
                      <i style={{ aspectRatio: `${a.w}/${a.h}` }} />
                      {a.id}
                    </button>
                  ))}
                </div>
                <Slider label={t('Width')} value={width} min={256} max={1536} step={64} onChange={(v) => setSize((c) => ({ ...c, w: snap(v) }))} />
                <Slider label={t('Height')} value={height} min={256} max={1536} step={64} onChange={(v) => setSize((c) => ({ ...c, h: snap(v) }))} />
              </Section>
              )}
              {isCloud ? (
                <Section title={mode === 'video' ? t('Length & sound') : t('Images')}>
                  {spec ? (
                    <>
                      <div className="studio-count">
                        <span>{t('Seconds')}</span>
                        {spec.durations.map((d) => (
                          <button key={d} className={cloudDur === d ? 'active' : ''} onClick={() => setDuration(d)}>
                            {d}s
                          </button>
                        ))}
                      </div>
                      {spec.audio && (
                        <label className="studio-check">
                          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
                          {t('Generate sound with the video')}
                        </label>
                      )}
                    </>
                  ) : (
                    <div className="studio-count">
                      <span>{t('Images')}</span>
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} className={count === n ? 'active' : ''} onClick={() => setCount(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="studio-hint num">
                    {estimate ? t('About {n} credits', { n: fmtCredits(Math.ceil(estimate)) }) : t('Charged by what the provider bills, in credits.')}
                    {cloud.state?.user ? ` · ${t('You have {n}', { n: fmtCredits(cloud.state.user.credits.total) })}` : ''}
                  </p>
                </Section>
              ) : (
              <Section title={mode === 'video' ? t('Motion & quality') : t('Quality')}>
                {!current ? null : gen.fixedSteps ? (
                  <p className="studio-hint">{current?.local ? t('This model always renders in {n} step — quality is already set.', { n: gen.presets[0] }) : t('The provider decides the quality of cloud images.')}</p>
                ) : (
                  <>
                    <div className="studio-seg">
                      {QUALITY.map((q, i) => (
                        <button key={q} className={quality === i ? 'active' : ''} onClick={() => setQuality(i as Quality)}>
                          {t(q)}
                          {i < 3 && <small className="num">{gen.presets[i]}</small>}
                        </button>
                      ))}
                    </div>
                    {quality === 3 ? (
                      <Slider label={t('Steps')} value={customSteps} min={1} max={60} onChange={setCustomSteps} />
                    ) : (
                      <p className="studio-hint">{t('{n} steps — recommended for {model}. Distilled “turbo” models look best with few steps; more steps mostly add time.', { n: steps, model: current?.label || '' })}</p>
                    )}
                  </>
                )}
                {mode === 'video' ? (
                  <>
                    <Slider label={t('Seconds')} value={duration} min={1} max={10} step={0.5} onChange={setDuration} />
                    <label className="studio-slider">
                      <span>FPS</span>
                      <div className="studio-fps">
                        {FPS.map((f) => (
                          <button key={f} className={fps === f ? 'active' : ''} onClick={() => setFps(f)}>
                            {f}
                          </button>
                        ))}
                      </div>
                    </label>
                    <p className="studio-hint num">{t('{f} frames · {fps} fps{native}', { f: frames, fps, native: gen.fps ? ` · ${t('model native: {n} fps', { n: gen.fps })}` : '' })}</p>
                  </>
                ) : (
                  <div className="studio-count">
                    <span>{t('Images')}</span>
                    {[1, 2, 3, 4, 6, 8].map((n) => (
                      <button key={n} className={count === n ? 'active' : ''} onClick={() => setCount(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                )}
                <div className="studio-seed">
                  <span>{t('Seed')}</span>
                  <input className="studio-num num" type="number" value={seed} disabled={randomSeed} onChange={(e) => setSeed(Number(e.target.value))} />
                  <button className={`orbi-btn ${randomSeed ? 'orbi-btn-primary' : ''}`} onClick={() => setRandomSeed((v) => !v)} title={t('Random seed')}>
                    <Dice5 size={13} /> {t('Random')}
                  </button>
                </div>
                {load && load !== 'ok' && (
                  <p className={`studio-load load-${load}`}>
                    {load === 'heavy' ? t('Heavy for this PC — it will take a while.') : t('Very heavy for this PC — it may take a long time or run out of memory. You can still try.')}
                  </p>
                )}
              </Section>
              )}
              {mode === 'image' ? (
                <Section title={t('Start from an image')} open={useInit || maskDirty}>
                  <label className="studio-check">
                    <input type="checkbox" checked={useInit} onChange={(e) => setUseInit(e.target.checked)} disabled={!base || base.kind !== 'image'} />
                    {t('Use the canvas image as the starting point')}
                  </label>
                  {useInit && !isCloud && <Slider label={t('Change')} value={strength} min={0.1} max={1} step={0.05} onChange={setStrength} />}
                  <p className="studio-hint">{current && !current.local ? (useInit ? t('The model uses this image as a reference for the new one.') : t('Pick an image in the gallery, then turn this on to edit it.')) : useInit ? t('Low = keep the original, high = reimagine it. Paint a mask to change only one area.') : t('Pick an image in the gallery, then turn this on to edit it.')}</p>
                </Section>
              ) : gen.image || spec ? (
                <Section title={t('First frame')} open={useInit}>
                  <label className="studio-check">
                    <input type="checkbox" checked={useInit} onChange={(e) => setUseInit(e.target.checked)} disabled={!base || base.kind !== 'image'} />
                    {t('Animate the canvas image')}
                  </label>
                  <p className="studio-hint">{t('The video starts from this image (image-to-video).')}</p>
                </Section>
              ) : null}
            </div>
            <div className="studio-invoke">
              <button className="studio-invoke-btn" disabled={!current || !prompt.trim()} onClick={invokeNow}>
                {mode === 'video' ? <Video size={15} /> : <Sparkles size={15} />}
                {mode === 'video' ? t('Generate video') : count > 1 ? t('Generate {n} images', { n: count }) : t('Generate image')}
              </button>
              {activeJobs.length > 0 && <p className="studio-hint num">{t('{n} in the queue · you can keep using Orbi', { n: activeJobs.length })}</p>}
            </div>
          </aside>

          <section className="studio-center">
            <div className="studio-toolbar" role="toolbar">
              <button className={tool === 'view' ? 'active' : ''} onClick={() => setTool('view')} title={t('View')}>
                <Maximize size={15} />
              </button>
              {mode === 'image' && (
                <>
                  <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')} title={t('Mask brush')}>
                    <Brush size={15} />
                  </button>
                  <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} title={t('Eraser')}>
                    <Eraser size={15} />
                  </button>
                </>
              )}
              {tool !== 'view' && (
                <label className="studio-brush">
                  <span className="num">{brush}px</span>
                  <input type="range" min={8} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                </label>
              )}
              <span className="studio-toolbar-sep" />
              <span className={`studio-mode-chip mode-${mode}`}>
                {mode === 'video' ? <Video size={12} /> : <ImageIcon size={12} />} {mode === 'video' ? t('Video') : t('Image')}
              </span>
              <span className="studio-size num">
                {isCloud ? `${aspect} · ${resLabel(cloudShort)}${mode === 'video' ? ` · ${cloudDur}s` : ''}` : `${width} × ${height}${mode === 'video' ? ` · ${frames}f` : ''}`}
              </span>
            </div>
            <div className="studio-stage" ref={stageRef}>
              <div className="studio-bbox" style={{ width: width * scale, height: height * scale }}>
                {base && baseVisible ? (
                  base.kind === 'video' ? (
                    <video src={base.url} controls autoPlay loop muted />
                  ) : (
                    <img src={base.dataUrl} alt={base.name} draggable={false} />
                  )
                ) : (
                  <div className="studio-bbox-empty">{!modeOptions.length ? (mode === 'video' ? t('Install a video model to start') : t('Install an image model to start')) : mode === 'video' ? t('Your video appears here') : t('Your image appears here')}</div>
                )}
                <canvas ref={maskRef} width={width} height={height} className={`studio-mask tool-${tool}`} style={{ opacity: maskVisible ? 1 : 0 }} onPointerDown={paint} />
                {focusJob && (
                  <div className="studio-render" role="status">
                    <div className="studio-shimmer" />
                    <div className="studio-render-card">
                      <span className={`studio-render-icon kind-${focusJob.mode}`}>{focusJob.mode === 'video' ? <Video size={16} /> : <ImageIcon size={16} />}</span>
                      <div className="min-w-0 flex-1">
                        <strong>{focusJob.mode === 'video' ? t('Rendering video…') : t('Rendering image…')}</strong>
                        <small className="num">
                          {jobStatus(focusJob)} · {secs(Date.now() - (focusJob.started || Date.now()))}
                        </small>
                        <div className="local-bar">
                          <i style={{ width: `${focusJob.total ? Math.max(3, ((focusJob.step || 0) / focusJob.total) * 100) : 6}%` }} className={focusJob.total ? '' : 'indeterminate'} />
                        </div>
                      </div>
                      <button className="orbi-btn" onClick={() => cancelJob(focusJob)} title={t('Stop')}>
                        <Square size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="studio-right">
            {jobs.length > 0 && (
              <div className="studio-queue">
                <div className="studio-panel-head">
                  <span>{t('Renders')}</span>
                  {jobs.some((j) => j.status === 'done' || j.status === 'error') && (
                    <button className="link-btn" onClick={() => setJobs((cur) => cur.filter((j) => j.status === 'queued' || j.status === 'running'))}>
                      {t('Clear')}
                    </button>
                  )}
                </div>
                <ul>
                  {[...jobs].reverse().slice(0, 8).map((j) => (
                    <li key={j.id} className={`job job-${j.status}`}>
                      <span className={`studio-render-icon kind-${j.mode}`}>
                        {j.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : j.status === 'queued' ? <Clock3 size={12} /> : j.mode === 'video' ? <Video size={12} /> : <ImageIcon size={12} />}
                      </span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => j.media && showInCanvas(j.media)} disabled={!j.media}>
                        <strong className="truncate">{j.label}</strong>
                        <small className={`truncate ${j.status === 'error' ? 'studio-error' : ''}`} title={j.error}>
                          {jobStatus(j)}
                          {j.status === 'done' && j.started && j.ended ? ` · ${secs(j.ended - j.started)}` : ''}
                        </small>
                      </button>
                      {(j.status === 'queued' || j.status === 'running') && (
                        <button className="studio-board-x" style={{ display: 'grid' }} onClick={() => cancelJob(j)} title={t('Stop')}>
                          <X size={11} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {BoardsPanel}
            <div className="studio-gallery">{shownMedia.length === 0 ? <p className="studio-hint px-1">{t('Generated images land here.')}</p> : shownMedia.slice(0, 60).map((m) => <Thumb key={m.id} m={m} />)}</div>
            <div className="studio-layers">
              <div className="studio-panel-head">
                <span>{t('Layers')}</span>
              </div>
              <div className="studio-layer">
                <button onClick={() => setMaskVisible((v) => !v)} aria-label={t('Toggle mask')}>
                  {maskVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <span className="studio-layer-swatch mask" />
                <span className="flex-1">{t('Inpaint mask')}</span>
                <button onClick={clearMask} disabled={!maskDirty} title={t('Clear mask')} aria-label={t('Clear mask')}>
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="studio-layer">
                <button onClick={() => setBaseVisible((v) => !v)} aria-label={t('Toggle image')}>
                  {baseVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <span className="studio-layer-swatch raster" />
                <span className="flex-1 truncate">{base ? base.name : t('Raster layer (empty)')}</span>
                <button onClick={() => setBase(null)} disabled={!base} title={t('Clear image')} aria-label={t('Clear image')}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* The workflow stays mounted after the first visit so a run continues while you use other tabs. */}
      {(flowMounted || tab === 'workflows') && (
        <Suspense fallback={tab === 'workflows' ? <div className="hub-skeleton" /> : null}>
          <NodeFlow visible={tab === 'workflows'} models={models} localStatus={localStatus} onOpenModels={onOpenModels} onMediaCreated={onMediaCreated} pendingTemplate={flowTemplate} onTemplateLoaded={() => setFlowTemplate(null)} />
        </Suspense>
      )}

      {tab === 'gallery' && (
        <div className="studio-gallery-page">
          <aside className="studio-right">{BoardsPanel}</aside>
          <section className="studio-gallery-grid">
            <div className="gallery-bar">
              <label className="gallery-search">
                <Search size={14} />
                <input value={galleryQuery} onChange={(e) => setGalleryQuery(e.target.value)} placeholder={t('Search prompts, names and models')} aria-label={t('Search the gallery')} />
                {galleryQuery && (
                  <button onClick={() => setGalleryQuery('')} aria-label={t('Clear search')}>
                    <X size={12} />
                  </button>
                )}
              </label>
              <div className="gallery-kinds" role="tablist">
                {(['all', 'image', 'video'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={galleryKind === k} className={galleryKind === k ? 'active' : ''} onClick={() => setGalleryKind(k)}>
                    {t(k === 'all' ? 'All' : k === 'image' ? 'Images' : 'Videos')}
                    <em className="num">{k === 'all' ? boardMedia.length : boardMedia.filter((m) => m.kind === k).length}</em>
                  </button>
                ))}
              </div>
            </div>
            {shownMedia.length === 0 ? (
              <div className="studio-empty-page">
                {gq ? <Search size={22} /> : <Images size={22} />}
                <p>{gq ? t('No match for “{q}”', { q: galleryQuery.trim() }) : t('Nothing here yet')}</p>
                <span>{gq ? t('Try a word from the prompt or the model name.') : t('Generate in the Canvas or move images into this board.')}</span>
              </div>
            ) : (
              shownMedia.map((m) => (
                <div key={m.id} className="studio-gallery-item">
                  <Thumb m={m} big />
                  <p className="truncate">{m.prompt || m.name}</p>
                  <small className="num">
                    {m.model} {fmtBytes(0)}
                  </small>
                </div>
              ))
            )}
          </section>
        </div>
      )}
      {viewing && viewing.list[viewing.index] && (
        <Lightbox
          items={viewing.list}
          index={viewing.index}
          onIndex={(index) => setViewing((v) => (v ? { ...v, index } : v))}
          onClose={() => setViewing(null)}
          onDeleted={(m) => {
            setMedia((cur) => cur.filter((x) => x.id !== m.id))
            setViewing((v) => (v ? { ...v, list: v.list.filter((x) => x.id !== m.id) } : v))
            if (base?.id === m.id) setBase(null)
          }}
          onUsePrompt={(m) => {
            usePromptOf(m)
            setViewing(null)
          }}
          onUpscale={hasUpscaler ? upscale : undefined}
          onMakeVideo={options.some((o) => o.kind === 'video') ? makeVideoFrom : undefined}
          onEdit={editInCanvas}
        />
      )}
    </main>
  )
}
