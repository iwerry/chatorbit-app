// Creative studio, organized like InvokeAI: Launchpad · Canvas · Workflows · Gallery.
// Left: generation settings. Center: canvas with inpaint mask. Right: boards, gallery and layers.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import {
  Brush,
  ChevronDown,
  ChevronLeft,
  Dice5,
  Download,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Loader2,
  Maximize,
  Plus,
  Rocket,
  Sparkles,
  Square,
  Trash2,
  Video,
  Wand2,
  Workflow,
  X,
} from 'lucide-react'
import { api, on, type Board, type LocalStatus, type MediaItem, type ModelInfo } from '../lib/api'
import { fmtBytes, t } from '../lib/i18n'
import { ThemeSwitcher, type ThemeMode } from './ThemeSwitcher'

const CreativeWorkspace = lazy(() => import('./Creative').then((m) => ({ default: m.CreativeWorkspace })))

type Tab = 'launchpad' | 'canvas' | 'workflows' | 'gallery'
type Option = { key: string; label: string; group: string; kind: 'image' | 'video'; local: boolean; providerId?: string; modelId: string }

const ASPECTS = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:3', w: 4, h: 3 },
  { id: '3:4', w: 3, h: 4 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
]

function snap(n: number) {
  return Math.max(256, Math.round(n / 64) * 64)
}

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
}: {
  themeMode: ThemeMode
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>
  onBack: () => void
  models: ModelInfo[]
  localStatus: LocalStatus | null
  onOpenModels: () => void
  onMediaCreated: (m: MediaItem) => void
}) {
  const [tab, setTab] = useState<Tab>('canvas')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [board, setBoard] = useState<string>('')
  const [newBoard, setNewBoard] = useState<string | null>(null)

  // generation settings
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [aspect, setAspect] = useState('1:1')
  const [width, setWidth] = useState(768)
  const [height, setHeight] = useState(768)
  const [steps, setSteps] = useState(0)
  const [seed, setSeed] = useState<number>(42)
  const [randomSeed, setRandomSeed] = useState(true)
  const [count, setCount] = useState(1)
  const [strength, setStrength] = useState(0.7)
  const [useInit, setUseInit] = useState(false)
  const [frames, setFrames] = useState(33)

  // canvas
  const [base, setBase] = useState<{ id?: string; dataUrl: string; name: string } | null>(null)
  const [baseVisible, setBaseVisible] = useState(true)
  const [maskVisible, setMaskVisible] = useState(true)
  const [maskDirty, setMaskDirty] = useState(false)
  const [tool, setTool] = useState<'brush' | 'eraser' | 'view'>('view')
  const [brush, setBrush] = useState(48)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 })

  // run state
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ step: number; total: number; index: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invoke, setInvoke] = useState<{ url: string; version: string } | null>(null)

  const loadMedia = useCallback(async () => {
    const [m, b] = await Promise.all([api.media(), api.boards()])
    setMedia(m)
    setBoards(b)
  }, [])
  useEffect(() => {
    loadMedia()
    api.detectInvoke().then(setInvoke).catch(() => {})
    api.getSetting('studioPrompt', '').then((v) => {
      if (v) {
        setPrompt(String(v))
        api.setSetting('studioPrompt', '')
      }
    })
    api.getSetting('studio', null as null | Record<string, unknown>).then((s) => {
      if (!s) return
      if (typeof s.modelKey === 'string') setModelKey(s.modelKey)
      if (typeof s.aspect === 'string') setAspect(s.aspect)
      if (typeof s.width === 'number') setWidth(s.width)
      if (typeof s.height === 'number') setHeight(s.height)
    })
  }, [])
  useEffect(() => on('local:progress', (p: { step: number; total: number }) => setProgress((cur) => ({ index: cur?.index ?? 0, ...p }))), [])

  // model options: installed local image/video models + cloud image models
  const options: Option[] = useMemo(() => {
    const out: Option[] = []
    for (const m of localStatus?.models ?? []) {
      if ((m.kind === 'image' || m.kind === 'video') && m.installed) out.push({ key: `local::${m.id}`, label: m.name, group: t('On this PC'), kind: m.kind, local: true, modelId: m.id })
    }
    for (const m of models.filter((x) => x.image)) out.push({ key: `cloud::${m.key}`, label: m.name, group: m.providerName, kind: 'image', local: false, providerId: m.provider, modelId: m.id })
    return out
  }, [localStatus, models])
  const current = options.find((o) => o.key === modelKey) ?? options[0]
  useEffect(() => {
    if (current) api.setSetting('studio', { modelKey: current.key, aspect, width, height })
  }, [current?.key, aspect, width, height])

  // stage size for fitting the bbox
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
    setWidth(w)
    setHeight(snap((w * a.h) / a.w))
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
    ctx.beginPath()
    ctx.arc(last.x, last.y, brush / 2, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
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
    if (!base) return undefined
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

  const loadIntoCanvas = async (m: MediaItem) => {
    if (m.kind !== 'image') return
    const dataUrl = await api.mediaDataUrl(m.id)
    if (!dataUrl) return
    setBase({ id: m.id, dataUrl, name: m.name })
    setBaseVisible(true)
    setTab('canvas')
  }

  // ---------- generation ----------
  const invokeNow = async () => {
    if (!current || !prompt.trim() || running) return
    setError(null)
    setRunning(true)
    const mask = useInit || maskDirty ? exportMask() : undefined
    const init = (useInit || mask) && base ? await exportInit() : undefined
    try {
      for (let i = 0; i < count; i++) {
        setProgress({ step: 0, total: 0, index: i })
        const s = randomSeed ? Math.floor(Math.random() * 2 ** 31) : seed + i
        const item = current.local
          ? await api.generateLocal({
              modelId: current.modelId,
              prompt: prompt.trim(),
              negative: negative.trim() || undefined,
              width,
              height,
              steps: steps || undefined,
              seed: s,
              initImage: init,
              mask: init ? mask : undefined,
              strength,
              frames: current.kind === 'video' ? frames : undefined,
              board,
            })
          : await api.generateImage({ providerId: current.providerId!, model: current.modelId, prompt: prompt.trim(), board, width, height, source: 'creative' })
        onMediaCreated(item)
        setMedia((cur) => [item, ...cur])
        if (item.kind === 'image') {
          const dataUrl = await api.mediaDataUrl(item.id)
          if (dataUrl) setBase({ id: item.id, dataUrl, name: item.name })
        }
      }
    } catch (e) {
      const msg = String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/abort|killed|SIGTERM/i.test(msg)) setError(msg)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const boardMedia = media.filter((m) => (board ? m.board === board : !m.board || true) && (m.kind === 'image' || m.kind === 'video'))
  const shownMedia = board ? boardMedia.filter((m) => m.board === board) : boardMedia
  const pct = progress?.total ? Math.round((progress.step / progress.total) * 100) : 0
  const noModels = options.length === 0

  const tabs: { id: Tab; label: string; icon: typeof Rocket }[] = [
    { id: 'launchpad', label: 'Launchpad', icon: Rocket },
    { id: 'canvas', label: 'Canvas', icon: LayoutGrid },
    { id: 'workflows', label: 'Workflows', icon: Workflow },
    { id: 'gallery', label: 'Gallery', icon: Images },
  ]

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

  const Thumb = ({ m, big = false }: { m: MediaItem; big?: boolean }) => (
    <div className={`studio-thumb ${base?.id === m.id ? 'active' : ''} ${big ? 'big' : ''}`} title={m.prompt || m.name}>
      {m.kind === 'video' ? <video src={m.url} muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} /> : <img src={m.url} alt={m.name} loading="lazy" onClick={() => loadIntoCanvas(m)} />}
      <div className="media-tile-tools">
        {m.kind === 'image' && (
          <button title={t('Open in canvas')} onClick={() => loadIntoCanvas(m)}>
            <LayoutGrid size={12} />
          </button>
        )}
        {m.prompt && (
          <button title={t('Use prompt')} onClick={() => setPrompt(m.prompt)}>
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

  return (
    <main className="studio">
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
                </button>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button className="orbi-btn" onClick={onOpenModels}>
            <Sparkles size={13} /> {t('Models')}
          </button>
          <ThemeSwitcher themeMode={themeMode} setThemeMode={setThemeMode} />
        </div>
      </header>

      {tab === 'launchpad' && (
        <div className="launchpad">
          <h2>{t('What do you want to create?')}</h2>
          <div className="launchpad-actions">
            <button
              onClick={() => {
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
                const v = options.find((o) => o.kind === 'video')
                if (v) setModelKey(v.key)
                setTab('canvas')
              }}
            >
              <Video size={20} />
              <strong>{t('Generate a video')}</strong>
              <span>{options.some((o) => o.kind === 'video') ? t('Short clips with Wan on this PC.') : t('Install a video model first.')}</span>
            </button>
            <button
              onClick={() => {
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
          <div className="launchpad-status">
            <p>
              <strong>{t('Engines')}</strong>
            </p>
            <ul>
              <li>
                <span className={`mcp-dot ${localStatus?.engines.sd.installed ? 'mcp-dot-connected' : ''}`} /> stable-diffusion.cpp · {localStatus?.engines.sd.installed ? t('installed') : t('downloads with the first model')}
              </li>
              <li>
                <span className={`mcp-dot ${options.some((o) => !o.local) ? 'mcp-dot-connected' : ''}`} /> {t('Cloud image models')} · {options.filter((o) => !o.local).length}
              </li>
              <li>
                <span className={`mcp-dot ${invoke ? 'mcp-dot-connected' : ''}`} /> InvokeAI ·{' '}
                {invoke ? (
                  <button className="link-btn" onClick={() => api.openExternal(invoke.url)}>
                    {t('running {v} — open', { v: invoke.version })} <ExternalLink size={11} className="inline" />
                  </button>
                ) : (
                  <button className="link-btn" onClick={() => api.openExternal('https://github.com/invoke-ai/InvokeAI')}>
                    {t('not detected (optional, runs at localhost:9090)')}
                  </button>
                )}
              </li>
            </ul>
            <button className="orbi-btn orbi-btn-primary mt-3" onClick={onOpenModels}>
              <Download size={13} /> {t('Get image & video models')}
            </button>
          </div>
        </div>
      )}

      {tab === 'canvas' && (
        <div className="studio-body">
          <aside className="studio-left">
            <div className="studio-scroll">
              <Section title={t('Prompt')}>
                <textarea className="studio-prompt" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('Describe the image or video…')} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && invokeNow()} />
                <textarea className="studio-prompt studio-negative" rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder={t('Negative prompt (what to avoid)')} />
              </Section>
              <Section title={t('Model')}>
                {noModels ? (
                  <div className="studio-empty">
                    <p>{t('No image models yet.')}</p>
                    <button className="orbi-btn orbi-btn-primary" onClick={onOpenModels}>
                      <Download size={13} /> {t('Get a model')}
                    </button>
                  </div>
                ) : (
                  <select className="ab-input" value={current?.key} onChange={(e) => setModelKey(e.target.value)}>
                    {[...new Set(options.map((o) => o.group))].map((g) => (
                      <optgroup key={g} label={g}>
                        {options
                          .filter((o) => o.group === g)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.kind === 'video' ? '🎞 ' : ''}
                              {o.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </Section>
              <Section title={t('Image')}>
                <div className="studio-aspects">
                  {ASPECTS.map((a) => (
                    <button key={a.id} className={aspect === a.id ? 'active' : ''} onClick={() => applyAspect(a.id)}>
                      <i style={{ aspectRatio: `${a.w}/${a.h}` }} />
                      {a.id}
                    </button>
                  ))}
                </div>
                <Slider label={t('Width')} value={width} min={256} max={1536} step={64} onChange={(v) => setWidth(snap(v))} />
                <Slider label={t('Height')} value={height} min={256} max={1536} step={64} onChange={(v) => setHeight(snap(v))} />
                <div className="studio-seed">
                  <span>{t('Seed')}</span>
                  <input className="studio-num num" type="number" value={seed} disabled={randomSeed} onChange={(e) => setSeed(Number(e.target.value))} />
                  <button className={`orbi-btn ${randomSeed ? 'orbi-btn-primary' : ''}`} onClick={() => setRandomSeed((v) => !v)} title={t('Random seed')}>
                    <Dice5 size={13} /> {t('Random')}
                  </button>
                </div>
              </Section>
              <Section title={t('Generation')}>
                <Slider label={t('Steps')} value={steps} min={0} max={50} onChange={setSteps} suffix={steps ? '' : t('auto')} />
                {current?.kind === 'video' && <Slider label={t('Frames')} value={frames} min={9} max={81} step={8} onChange={setFrames} />}
                <Slider label={t('Images')} value={count} min={1} max={4} onChange={setCount} />
              </Section>
              <Section title={t('Compositing')} open={useInit || maskDirty}>
                <label className="studio-check">
                  <input type="checkbox" checked={useInit} onChange={(e) => setUseInit(e.target.checked)} disabled={!base} />
                  {t('Use the canvas image as the starting point')}
                </label>
                <Slider label={t('Strength')} value={strength} min={0.1} max={1} step={0.05} onChange={setStrength} />
                <p className="studio-hint">{current && !current.local ? t('Image editing works with local models.') : t('Paint a mask to change only that area (inpainting).')}</p>
              </Section>
            </div>
            <div className="studio-invoke">
              {running && progress && (
                <div className="studio-progress">
                  <span className="num">
                    {count > 1 ? `${progress.index + 1}/${count} · ` : ''}
                    {progress.total ? `${progress.step}/${progress.total}` : t('Loading model…')}
                  </span>
                  <div className="local-bar">
                    <i style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              )}
              {error && <p className="studio-error">{error}</p>}
              <div className="flex gap-2">
                <button className="studio-invoke-btn" disabled={!current || !prompt.trim() || running} onClick={invokeNow}>
                  {running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {running ? t('Generating…') : t('Invoke')}
                </button>
                {running && (
                  <button className="orbi-btn" onClick={() => api.cancelLocalGenerate()} title={t('Cancel')} aria-label={t('Cancel')}>
                    <Square size={12} />
                  </button>
                )}
              </div>
            </div>
          </aside>

          <section className="studio-center">
            <div className="studio-toolbar" role="toolbar">
              <button className={tool === 'view' ? 'active' : ''} onClick={() => setTool('view')} title={t('View')}>
                <Maximize size={15} />
              </button>
              <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')} title={t('Mask brush')}>
                <Brush size={15} />
              </button>
              <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} title={t('Eraser')}>
                <Eraser size={15} />
              </button>
              {tool !== 'view' && (
                <label className="studio-brush">
                  <span className="num">{brush}px</span>
                  <input type="range" min={8} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                </label>
              )}
              <span className="studio-toolbar-sep" />
              <span className="studio-size num">
                {width} × {height}
              </span>
            </div>
            <div className="studio-stage" ref={stageRef}>
              <div className="studio-bbox" style={{ width: width * scale, height: height * scale }}>
                {base && baseVisible ? <img src={base.dataUrl} alt={base.name} draggable={false} /> : <div className="studio-bbox-empty">{noModels ? t('Install an image model to start') : t('Your image appears here')}</div>}
                <canvas ref={maskRef} width={width} height={height} className={`studio-mask tool-${tool}`} style={{ opacity: maskVisible ? 1 : 0 }} onPointerDown={paint} />
                {running && <div className="studio-shimmer" />}
              </div>
            </div>
          </section>

          <aside className="studio-right">
            {BoardsPanel}
            <div className="studio-gallery">
              {shownMedia.length === 0 ? <p className="studio-hint px-1">{t('Generated images land here.')}</p> : shownMedia.slice(0, 60).map((m) => <Thumb key={m.id} m={m} />)}
            </div>
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

      {tab === 'workflows' && (
        <Suspense fallback={<div className="hub-skeleton" />}>
          <CreativeWorkspace themeMode={themeMode} setThemeMode={setThemeMode} onBack={onBack} models={models} onOpenSettings={onOpenModels} onMediaCreated={onMediaCreated} embedded />
        </Suspense>
      )}

      {tab === 'gallery' && (
        <div className="studio-gallery-page">
          <aside className="studio-right">{BoardsPanel}</aside>
          <section className="studio-gallery-grid">
            {shownMedia.length === 0 ? (
              <div className="studio-empty-page">
                <Images size={22} />
                <p>{t('Nothing here yet')}</p>
                <span>{t('Generate in the Canvas or move images into this board.')}</span>
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
    </main>
  )
}
