import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import {
  AudioLines,
  Box,
  ChevronLeft,
  Copy,
  Download,
  FileText,
  Hand,
  Image as ImageIcon,
  Loader2,
  type LucideIcon,
  Moon,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  Scissors,
  Search,
  Settings,
  SquareTerminal,
  StickyNote,
  Sun,
  Trash2,
  Undo2,
  Video,
  WandSparkles,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { api, type MediaItem, type ModelInfo } from '../lib/api'

export type ThemeMode = 'light' | 'dark' | 'terminal'

type Kind = 'prompt' | 'image' | 'video' | 'audio' | 'text' | 'output' | 'designer' | 'three-d'

type CNode = {
  id: string
  kind: Kind
  title: string
  subtitle: string
  x: number
  y: number
  text?: string
  model?: string
  media?: { id: string; url: string; name: string }
  status?: 'idle' | 'running' | 'done' | 'error'
  error?: string
}

type Edge = [string, string]

const catalog: { kind: Kind; title: string; subtitle: string; icon: LucideIcon; group: 'Text' | 'Image' | 'Video' | 'Audio' | 'Output' }[] = [
  { kind: 'prompt', title: 'Creative brief', subtitle: 'Text', icon: FileText, group: 'Text' },
  { kind: 'image', title: 'Generate image', subtitle: 'Image', icon: ImageIcon, group: 'Image' },
  { kind: 'video', title: 'Generate video', subtitle: 'Video', icon: Video, group: 'Video' },
  { kind: 'audio', title: 'Voiceover', subtitle: 'Audio', icon: AudioLines, group: 'Audio' },
  { kind: 'text', title: 'Script writer', subtitle: 'Text', icon: StickyNote, group: 'Text' },
  { kind: 'designer', title: 'Image editor', subtitle: 'Design', icon: WandSparkles, group: 'Image' },
  { kind: 'three-d', title: '3D generator', subtitle: '3D', icon: Box, group: 'Image' },
  { kind: 'output', title: 'Export media', subtitle: 'Output', icon: Download, group: 'Output' },
]

const initialNodes: CNode[] = [
  { id: 'n1', kind: 'prompt', title: 'Campaign brief', subtitle: 'Describe the visual direction', x: 110, y: 165, text: 'A cinematic product launch for a minimalist smartwatch, soft volumetric light, bold contrast, elegant composition.' },
  { id: 'n2', kind: 'image', title: 'Key visual', subtitle: 'Generate a cinematic frame', x: 420, y: 60 },
  { id: 'n3', kind: 'video', title: 'Animate scene', subtitle: 'Image to video · 6 seconds', x: 730, y: 150 },
  { id: 'n4', kind: 'audio', title: 'Voiceover', subtitle: 'Warm documentary voice', x: 420, y: 380 },
  { id: 'n5', kind: 'output', title: 'Final cut', subtitle: '1080p · Social campaign', x: 1040, y: 170 },
]
const initialEdges: Edge[] = [
  ['n1', 'n2'],
  ['n2', 'n3'],
  ['n1', 'n4'],
  ['n3', 'n5'],
  ['n4', 'n5'],
  ['n2', 'n5'],
]

const NODE_W = 250
const PORT_Y = 92

type Props = {
  themeMode: ThemeMode
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>
  onBack: () => void
  models: ModelInfo[]
  onOpenSettings: () => void
  onMediaCreated: (m: MediaItem) => void
}

export function CreativeWorkspace({ themeMode, setThemeMode, onBack, models, onOpenSettings, onMediaCreated }: Props) {
  const [nodes, setNodes] = useState<CNode[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>('n2')
  const [tool, setTool] = useState<'select' | 'hand' | 'cut' | 'connect' | 'note' | 'pen' | 'sticker'>('select')
  const [flyout, setFlyout] = useState<'links' | 'markup' | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryTab, setLibraryTab] = useState<'All' | 'Video' | 'Image' | 'Audio'>('All')
  const [zoom, setZoom] = useState(90)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [saved, setSaved] = useState<'Saved' | 'Saving…'>('Saved')
  const [toast, setToast] = useState<string | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const history = useRef<{ nodes: CNode[]; edges: Edge[] }[]>([])
  const future = useRef<{ nodes: CNode[]; edges: Edge[] }[]>([])

  const imageModels = useMemo(() => models.filter((m) => m.image), [models])

  // load + autosave
  useEffect(() => {
    api.getWorkflow('default').then((w) => {
      if (w?.nodes) {
        setNodes(w.nodes.map((n: CNode) => ({ ...n, status: n.status === 'running' ? 'idle' : n.status })))
        setEdges(w.edges ?? [])
      }
      setLoaded(true)
    })
  }, [])
  useEffect(() => {
    if (!loaded) return
    setSaved('Saving…')
    const t = setTimeout(() => {
      api.saveWorkflow('default', 'Untitled workflow', { nodes, edges })
      setSaved('Saved')
    }, 500)
    return () => clearTimeout(t)
  }, [nodes, edges, loaded])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3800)
    return () => clearTimeout(t)
  }, [toast])

  const snapshot = () => {
    history.current.push({ nodes, edges })
    if (history.current.length > 60) history.current.shift()
    future.current = []
  }
  const undo = () => {
    const prev = history.current.pop()
    if (!prev) return
    future.current.push({ nodes, edges })
    setNodes(prev.nodes)
    setEdges(prev.edges)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    history.current.push({ nodes, edges })
    setNodes(next.nodes)
    setEdges(next.edges)
  }

  const update = (id: string, patch: Partial<CNode>) => {
    nodesRef.current = nodesRef.current.map((n) => (n.id === id ? { ...n, ...patch } : n))
    setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  }

  const visibleCatalog = catalog.filter(
    (c) => c.title.toLowerCase().includes(librarySearch.toLowerCase()) && (libraryTab === 'All' || c.group === libraryTab),
  )

  const addNode = (item: (typeof catalog)[number]) => {
    snapshot()
    const id = 'n' + Date.now().toString(36)
    const offset = nodes.length * 28
    setNodes((cur) => [
      ...cur,
      { id, kind: item.kind, title: item.title, subtitle: item.subtitle, x: 240 + (offset % 520) - pan.x, y: 180 + (offset % 260) - pan.y, text: item.kind === 'prompt' || item.kind === 'text' ? '' : undefined },
    ])
    setSelected(id)
  }

  const removeNode = (id: string) => {
    snapshot()
    setNodes((cur) => cur.filter((n) => n.id !== id))
    setEdges((cur) => cur.filter(([a, b]) => a !== id && b !== id))
    setSelected(null)
  }

  const duplicateNode = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    snapshot()
    const copy = { ...n, id: 'n' + Date.now().toString(36), x: n.x + 36, y: n.y + 36, status: 'idle' as const, error: undefined }
    setNodes((cur) => [...cur, copy])
    setSelected(copy.id)
  }

  const upstreamText = (id: string): string => {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    const parts: string[] = []
    const seen = new Set<string>()
    const walk = (nid: string) => {
      for (const [a, b] of edges) {
        if (b !== nid || seen.has(a)) continue
        seen.add(a)
        const src = nodes.find((n) => n.id === a)
        if (src && (src.kind === 'prompt' || src.kind === 'text') && src.text?.trim()) parts.push(src.text.trim())
        walk(a)
      }
    }
    walk(id)
    return parts.reverse().join('\n')
  }

  const runNode = async (id: string): Promise<boolean> => {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    const n = nodes.find((x) => x.id === id)
    if (!n) return false
    if (n.kind === 'image' || n.kind === 'designer') {
      const prompt = [upstreamText(id), n.text?.trim()].filter(Boolean).join('\n')
      if (!prompt) {
        update(id, { status: 'error', error: 'Connect a brief or write a prompt for this node.' })
        return false
      }
      const modelKey = n.model || imageModels[0]?.key
      const model = imageModels.find((m) => m.key === modelKey)
      if (!model) {
        update(id, { status: 'error', error: 'No image model yet. Connect OpenRouter or OpenAI in Settings.' })
        setToast('Connect an image-capable provider in Settings → AI providers.')
        return false
      }
      update(id, { status: 'running', error: undefined, model: model.key })
      try {
        const media = await api.generateImage({ providerId: model.provider, model: model.id, prompt, source: 'creative' })
        update(id, { status: 'done', media: { id: media.id, url: media.url, name: media.name } })
        onMediaCreated(media)
        return true
      } catch (e) {
        update(id, { status: 'error', error: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
        return false
      }
    }
    if (n.kind === 'video' || n.kind === 'audio' || n.kind === 'three-d') {
      update(id, { status: 'error', error: `${n.subtitle} generation arrives with the OrbiX cloud and local engines in the next build.` })
      return false
    }
    if (n.kind === 'output') {
      const inputs = edgesRef.current.filter(([, b]) => b === id).map(([a]) => nodesRef.current.find((x) => x.id === a)?.media).filter(Boolean)
      if (!inputs.length) {
        update(id, { status: 'error', error: 'Nothing to export yet — run an image node first.' })
        return false
      }
      update(id, { status: 'done', error: undefined, media: inputs[inputs.length - 1] })
      return true
    }
    return true
  }

  const runWorkflow = async () => {
    const order = ['prompt', 'text', 'image', 'designer', 'video', 'audio', 'three-d', 'output']
    const runnable = [...nodesRef.current].filter((n) => n.kind === 'image' || n.kind === 'designer' || n.kind === 'output').sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    let made = 0
    for (const n of runnable) if ((await runNode(n.id)) && n.kind !== 'output') made++
    setToast(made ? `Workflow finished · ${made} image${made > 1 ? 's' : ''} saved to your Media Library.` : 'Workflow finished with errors — check the red notes on the nodes.')
  }

  // ---------- pointer interactions ----------
  const startNodeDrag = (id: string, e: ReactPointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, select, button, input, .creative-node-actionbar')) return
    if (tool === 'connect') {
      if (!connectFrom) setConnectFrom(id)
      else if (connectFrom !== id) {
        snapshot()
        setEdges((cur) => (cur.some(([a, b]) => a === connectFrom && b === id) ? cur : [...cur, [connectFrom, id]]))
        setConnectFrom(null)
      }
      return
    }
    if (tool !== 'select') return
    e.preventDefault()
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    setSelected(id)
    snapshot()
    const sx = e.clientX
    const sy = e.clientY
    const ox = n.x
    const oy = n.y
    const scale = zoom / 100
    const move = (ev: PointerEvent) => update(id, { x: Math.max(12, ox + (ev.clientX - sx) / scale), y: Math.max(12, oy + (ev.clientY - sy) / scale) })
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('creative-canvas-content')) return
    setSelected(null)
    if (tool !== 'hand' && e.button !== 1) return
    const sx = e.clientX
    const sy = e.clientY
    const o = { ...pan }
    const move = (ev: PointerEvent) => setPan({ x: o.x + (ev.clientX - sx) / (zoom / 100), y: o.y + (ev.clientY - sy) / (zoom / 100) })
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, select')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeNode(selected)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') (e.shiftKey ? redo : undo)()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected) {
        e.preventDefault()
        duplicateNode(selected)
      }
      if (e.key === 'Escape') setConnectFrom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <main className="creative-workspace">
      <header className="creative-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <button className="creative-topbar-button" onClick={onBack} aria-label="Back to chats">
            <ChevronLeft size={17} />
          </button>
          <div className="creative-project-mark" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">Creative production</p>
            <span>Untitled workflow</span>
          </div>
        </div>
        <div className="creative-topbar-actions">
          <span className="creative-saved-state">{saved}</span>
          <button className="creative-share-button" onClick={onOpenSettings}>
            <Settings size={15} />
            <span>Providers</span>
          </button>
          <button className="creative-run-button" onClick={runWorkflow}>
            <Play size={14} fill="currentColor" />
            <span>Run workflow</span>
          </button>
          <ThemeSwitcher themeMode={themeMode} setThemeMode={setThemeMode} />
        </div>
      </header>

      <section className="creative-stage">
        {libraryOpen && (
          <aside className="creative-library">
            <div className="creative-library-heading">
              <div>
                <p>Node library</p>
                <span>Build your production workflow</span>
              </div>
              <button onClick={() => setLibraryOpen(false)} aria-label="Close node library">
                <X size={15} />
              </button>
            </div>
            <label className="creative-library-search">
              <Search size={15} />
              <input value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} placeholder="Search nodes" />
            </label>
            <div className="creative-library-tabs">
              {(['All', 'Video', 'Image', 'Audio'] as const).map((t) => (
                <button key={t} className={libraryTab === t ? 'creative-library-tab-active' : ''} onClick={() => setLibraryTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="creative-library-scroll">
              <p className="creative-library-label">Media & creation</p>
              <div className="creative-library-list">
                {visibleCatalog.map((item) => {
                  const Icon = item.icon
                  return (
                    <button key={item.kind} className={`creative-library-item creative-kind-${item.kind}`} onClick={() => addNode(item)}>
                      <span>
                        <Icon size={15} />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>{item.subtitle}</small>
                      </div>
                      <Plus size={13} className="ml-auto" />
                    </button>
                  )
                })}
              </div>
              <p className="creative-library-label mt-6">Image models connected</p>
              <div className="creative-provider-grid">
                {imageModels.length ? (
                  [...new Set(imageModels.map((m) => m.providerName))].map((p) => <span key={p}>{p}</span>)
                ) : (
                  <span className="cursor-pointer" onClick={onOpenSettings}>
                    + Connect
                  </span>
                )}
              </div>
            </div>
          </aside>
        )}

        <div className={`creative-toolbar ${libraryOpen ? 'creative-toolbar-shifted' : ''}`}>
          <button onClick={() => setLibraryOpen((v) => !v)} title="Node library">
            <Plus size={18} />
          </button>
          <span />
          <button className={tool === 'select' ? 'creative-tool-active' : ''} onClick={() => setTool('select')} title="Select & move">
            <MousePointer2 size={17} />
          </button>
          <button className={tool === 'hand' ? 'creative-tool-active' : ''} onClick={() => setTool('hand')} title="Pan canvas">
            <Hand size={17} />
          </button>
          <div className="creative-tool-group">
            <button className={tool === 'cut' || tool === 'connect' ? 'creative-tool-active' : ''} onClick={() => setFlyout((c) => (c === 'links' ? null : 'links'))} title={tool === 'connect' ? 'Connect' : 'Cut'}>
              {tool === 'connect' ? <Workflow size={17} /> : <Scissors size={17} />}
            </button>
            {flyout === 'links' && (
              <div className="creative-tool-flyout">
                <button
                  className={tool === 'cut' ? 'creative-tool-active' : ''}
                  onClick={() => {
                    setTool('cut')
                    setFlyout(null)
                  }}
                  title="Cut a connection (click a line)"
                >
                  <Scissors size={17} />
                </button>
                <button
                  className={tool === 'connect' ? 'creative-tool-active' : ''}
                  onClick={() => {
                    setTool('connect')
                    setFlyout(null)
                  }}
                  title="Connect: click a source node, then a target node"
                >
                  <Workflow size={17} />
                </button>
              </div>
            )}
          </div>
          <div className="creative-tool-group">
            <button
              onClick={() => {
                snapshot()
                const id = 'n' + Date.now().toString(36)
                setNodes((cur) => [...cur, { id, kind: 'text', title: 'Note', subtitle: 'Text', x: 300 - pan.x, y: 420 - pan.y, text: '' }])
                setSelected(id)
              }}
              title="Add note"
            >
              <StickyNote size={17} />
            </button>
          </div>
          <span />
          <button title="Undo (Ctrl+Z)" onClick={undo}>
            <Undo2 size={17} />
          </button>
          <button title="Redo (Ctrl+Shift+Z)" onClick={redo}>
            <Redo2 size={17} />
          </button>
        </div>

        <div className={`creative-canvas creative-tool-${tool}`} onPointerDown={startPan}>
          <div className="hero-signal-field creative-signal-field" aria-hidden="true">
            <span className="hero-grid" />
            <span className="hero-orbit hero-orbit-one">
              <i />
            </span>
            <span className="hero-orbit hero-orbit-two">
              <i />
            </span>
            <span className="hero-orbit hero-orbit-three">
              <i />
            </span>
          </div>
          <div className="creative-canvas-content" style={{ transform: `scale(${zoom / 100}) translate(${pan.x}px, ${pan.y}px)` }}>
            <svg className="creative-connections" aria-hidden="true">
              {edges.map(([fromId, toId]) => {
                const from = nodes.find((n) => n.id === fromId)
                const to = nodes.find((n) => n.id === toId)
                if (!from || !to) return null
                const sx = from.x + NODE_W
                const sy = from.y + PORT_Y
                const ex = to.x
                const ey = to.y + PORT_Y
                const curve = Math.max(70, Math.abs(ex - sx) * 0.42)
                const d = `M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`
                return (
                  <g key={`${fromId}-${toId}`}>
                    <path d={d} />
                    {tool === 'cut' && (
                      <path
                        d={d}
                        className="creative-edge-hit"
                        onClick={() => {
                          snapshot()
                          setEdges((cur) => cur.filter(([a, b]) => !(a === fromId && b === toId)))
                        }}
                      />
                    )}
                  </g>
                )
              })}
            </svg>

            {nodes.map((node) => {
              const item = catalog.find((c) => c.kind === node.kind)
              const Icon = item?.icon ?? Workflow
              const isSel = selected === node.id
              const isMedia = node.kind === 'image' || node.kind === 'video' || node.kind === 'designer' || node.kind === 'three-d'
              const nodeModel = imageModels.find((m) => m.key === node.model)
              return (
                <div
                  key={node.id}
                  className={`creative-node creative-kind-${node.kind} ${isSel ? 'creative-node-selected' : ''} ${connectFrom === node.id ? 'creative-node-connecting' : ''}`}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(e) => startNodeDrag(node.id, e)}
                  role="button"
                  tabIndex={0}
                >
                  {isSel && (
                    <div className="creative-node-actionbar">
                      <button title="Run node" onClick={() => runNode(node.id)}>
                        <Play size={13} fill="currentColor" />
                      </button>
                      <button
                        title="Connect from here"
                        onClick={() => {
                          setTool('connect')
                          setConnectFrom(node.id)
                        }}
                      >
                        <Workflow size={13} />
                      </button>
                      <button title="Duplicate (Ctrl+D)" onClick={() => duplicateNode(node.id)}>
                        <Copy size={13} />
                      </button>
                      <button title="Delete (Del)" onClick={() => removeNode(node.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  <span className="creative-node-input" />
                  <div className="creative-node-header">
                    <div className="creative-node-icon">
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <strong>{node.title}</strong>
                      <small>{node.subtitle}</small>
                    </div>
                    {node.status === 'running' && <Loader2 size={15} className="animate-spin" />}
                  </div>

                  <div className="creative-node-body">
                    {isMedia &&
                      (node.media ? (
                        <img className="creative-node-image" src={node.media.url} alt={node.title} onDoubleClick={() => api.openMedia(node.media!.id)} />
                      ) : (
                        <div className={`creative-media-preview creative-preview-${node.kind}`}>
                          {node.status === 'running' ? (
                            <Loader2 size={22} className="animate-spin" />
                          ) : node.kind === 'video' ? (
                            <Play size={22} fill="currentColor" />
                          ) : node.kind === 'three-d' ? (
                            <Box size={23} />
                          ) : (
                            <ImageIcon size={23} />
                          )}
                          <span>{node.status === 'running' ? 'Generating…' : node.kind === 'video' ? 'Scene preview' : node.kind === 'three-d' ? '3D preview' : 'Visual preview'}</span>
                        </div>
                      ))}

                    {(node.kind === 'prompt' || node.kind === 'text') && (
                      <textarea
                        className="creative-node-textarea"
                        value={node.text ?? ''}
                        placeholder={node.kind === 'prompt' ? 'Describe the visual direction…' : 'Write a note or script…'}
                        onChange={(e) => update(node.id, { text: e.target.value })}
                        rows={4}
                      />
                    )}

                    {(node.kind === 'image' || node.kind === 'designer') && (
                      <>
                        <input
                          className="creative-node-input-text"
                          placeholder="Extra prompt (optional)"
                          value={node.text ?? ''}
                          onChange={(e) => update(node.id, { text: e.target.value })}
                        />
                        <select className="creative-node-select" value={node.model ?? imageModels[0]?.key ?? ''} onChange={(e) => update(node.id, { model: e.target.value })}>
                          {imageModels.length === 0 && <option value="">No image model connected</option>}
                          {imageModels.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.name} · {m.providerName}
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    {node.kind === 'audio' && (
                      <div className="creative-audio-preview">
                        <AudioLines size={16} />
                        <div>
                          {[3, 7, 11, 6, 14, 9, 5, 12, 8, 4, 10, 6].map((h, i) => (
                            <i key={i} style={{ height: h }} />
                          ))}
                        </div>
                        <span>00:12</span>
                      </div>
                    )}

                    {node.kind === 'output' &&
                      (node.media ? (
                        <button className="creative-output-preview creative-output-ready" onClick={() => api.saveMediaAs(node.media!.id)}>
                          <Download size={21} />
                          <span>Export {node.media.name}</span>
                        </button>
                      ) : (
                        <div className="creative-output-preview">
                          <Download size={21} />
                          <span>Ready for final render</span>
                        </div>
                      ))}

                    {node.status === 'error' && node.error && <p className="creative-node-error">{node.error}</p>}
                  </div>

                  <div className="creative-node-controls">
                    <span>{nodeModel ? nodeModel.providerName : 'Auto'}</span>
                    <span>{node.kind === 'audio' ? '48 kHz' : node.kind === 'text' || node.kind === 'prompt' ? 'Script' : '1:1'}</span>
                    <span>{node.kind === 'video' ? '6 sec' : node.kind === 'output' ? '1080p' : '1×'}</span>
                    <b role="button" title="Run node" onClick={() => runNode(node.id)}>
                      <Play size={10} fill="currentColor" />
                    </b>
                  </div>
                  <span className="creative-node-output" />
                  <span className="creative-node-side-port creative-node-side-port-one" />
                  <span className="creative-node-side-port creative-node-side-port-two" />
                </div>
              )
            })}
          </div>
        </div>

        {tool === 'connect' && <div className="creative-hint">{connectFrom ? 'Now click the target node · Esc to cancel' : 'Click the source node'}</div>}
        {tool === 'cut' && <div className="creative-hint">Click a connection line to remove it</div>}
        {toast && <div className="creative-hint creative-toast">{toast}</div>}

        <div className="creative-canvas-footer">
          <span>
            {nodes.length} nodes · {edges.length} connections
          </span>
          <div>
            <button onClick={() => setZoom((z) => Math.max(40, z - 10))} aria-label="Zoom out">
              <ZoomOut size={15} />
            </button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((z) => Math.min(150, z + 10))} aria-label="Zoom in">
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

export function ThemeSwitcher({ themeMode, setThemeMode }: { themeMode: ThemeMode; setThemeMode: Dispatch<SetStateAction<ThemeMode>> }) {
  return (
    <div className="theme-switcher" aria-label="Interface theme">
      <button className={themeMode === 'light' ? 'theme-option-active' : ''} onClick={() => setThemeMode('light')} aria-label="Light theme" aria-pressed={themeMode === 'light'} title="Light">
        <Sun size={13} />
      </button>
      <button className={themeMode === 'dark' ? 'theme-option-active' : ''} onClick={() => setThemeMode('dark')} aria-label="Dark theme" aria-pressed={themeMode === 'dark'} title="Dark">
        <Moon size={13} />
      </button>
      <button className={themeMode === 'terminal' ? 'theme-option-active' : ''} onClick={() => setThemeMode('terminal')} aria-label="Terminal theme" aria-pressed={themeMode === 'terminal'} title="Terminal">
        <SquareTerminal size={14} />
      </button>
    </div>
  )
}
