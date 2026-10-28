// Media Library as a full page: every image, video, audio and file made or imported anywhere in Orbi.
// Search, boards, kind filters, the full-screen viewer, and quick follow-ups (make a video, upscale, edit, use prompt).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Clapperboard, Download, FileText, FolderOpen, Image as ImageIcon, Library, Maximize, Maximize2, MessageSquareText, Music, Search, Trash2, Upload, Video, Wand2, WandSparkles, X } from 'lucide-react'
import { api, type Board, type LocalStatus, type MediaItem } from '../lib/api'
import { fmtDate, t } from '../lib/i18n'
import { creativeBus, openInCreative } from '../lib/creativeBus'
import { DEFAULT_NEGATIVE } from '../lib/ideas'
import { Lightbox } from './Lightbox'
import { ThemeSwitcher, type ThemeMode } from './ThemeSwitcher'
import { sendPromptToCreative } from './WorkspacePanel'
import type { Dispatch, SetStateAction } from 'react'

type Kind = 'all' | 'image' | 'video' | 'audio' | 'file'
type Source = '' | 'chat' | 'creative' | 'upload'
const rid = () => Math.random().toString(36).slice(2, 10)

export function MediaLibrary({
  media,
  localStatus,
  onRefresh,
  onBack,
  onOpenCreative,
  onOpenModels,
  themeMode,
  setThemeMode,
}: {
  media: MediaItem[]
  localStatus: LocalStatus | null
  onRefresh: () => void
  onBack: () => void
  onOpenCreative: () => void
  onOpenModels: () => void
  themeMode: ThemeMode
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>
}) {
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  const [board, setBoard] = useState('')
  const [source, setSource] = useState<Source>('')
  const [boards, setBoards] = useState<Board[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.boards().then(setBoards)
  }, [media.length])
  useEffect(() => {
    if (!toast) return
    const tm = setTimeout(() => setToast(''), 3600)
    return () => clearTimeout(tm)
  }, [toast])
  // Ctrl+F / "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.closest?.('input, textarea')) return
      if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasUpscaler = !!localStatus?.models.some((m) => m.kind === 'upscale' && m.installed)
  const hasVideo = !!localStatus?.models.some((m) => m.kind === 'video' && m.installed)
  const kindOf = (m: MediaItem): Exclude<Kind, 'all'> => (m.kind === 'image' || m.kind === 'video' || m.kind === 'audio' ? m.kind : 'file')
  const inScope = media.filter((m) => (!board || m.board === board) && (!source || (source === 'creative' ? m.source === 'creative' || m.source === 'canvas' : m.source === source)))
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => inScope.filter((m) => (kind === 'all' || kindOf(m) === kind) && (!q || `${m.prompt} ${m.name} ${m.model}`.toLowerCase().includes(q))), [inScope, kind, q])
  const count = (k: Kind) => (k === 'all' ? inScope.length : inScope.filter((m) => kindOf(m) === k).length)

  const makeVideo = (m: MediaItem) => {
    if (!hasVideo) {
      setViewing(null)
      setToast(t('Download a video model in Models first'))
      onOpenModels()
      return false
    }
    creativeBus.request({ id: rid(), mode: 'video', prompt: m.prompt || t('Gentle camera move, natural motion'), negative: DEFAULT_NEGATIVE.video, initMediaId: m.id, aspect: '16:9', source: 'creative' })
    setToast(t('Video queued in Creative — it will show up here when it is ready.'))
    return true
  }
  const upscale = (m: MediaItem) => {
    if (!hasUpscaler) {
      setViewing(null)
      setToast(t('Download an upscaler in Models first (Real-ESRGAN).'))
      onOpenModels()
      return false
    }
    creativeBus.request({ id: rid(), mode: 'upscale', prompt: m.prompt || m.name, initMediaId: m.id })
    setToast(t('Upscale queued in Creative — the sharper copy lands here.'))
    return true
  }
  const edit = (m: MediaItem) => {
    openInCreative({ prompt: m.prompt || '', mode: 'image', initMediaId: m.id })
    onOpenCreative()
  }
  const remove = async (m: MediaItem) => {
    if (!confirm(t('Delete this file from the library?'))) return
    await api.deleteMedia(m.id)
    onRefresh()
  }

  const kinds: { id: Kind; label: string; icon: typeof ImageIcon }[] = [
    { id: 'all', label: 'All', icon: Library },
    { id: 'image', label: 'Images', icon: ImageIcon },
    { id: 'video', label: 'Videos', icon: Video },
    { id: 'audio', label: 'Audio', icon: Music },
    { id: 'file', label: 'Files', icon: FileText },
  ]
  const sources: { id: Source; label: string; icon: typeof ImageIcon }[] = [
    { id: '', label: 'Everything', icon: Library },
    { id: 'chat', label: 'Made in chat', icon: MessageSquareText },
    { id: 'creative', label: 'Made in Creative', icon: WandSparkles },
    { id: 'upload', label: 'Imported', icon: Upload },
  ]

  return (
    <main className="studio media-page">
      <header className="studio-top">
        <div className="flex min-w-0 items-center gap-2">
          <button className="creative-topbar-button" onClick={onBack} aria-label={t('Back to chats')}>
            <ChevronLeft size={17} />
          </button>
          <span className="studio-title">{t('Media Library')}</span>
          <nav className="studio-tabs" role="tablist">
            {kinds.map((k) => (
              <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'active' : ''} onClick={() => setKind(k.id)}>
                <k.icon size={14} />
                {t(k.label)}
                <span className="studio-tab-count num">{count(k.id)}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button className="orbi-btn" onClick={() => input.current?.click()}>
            <Upload size={13} /> {t('Import')}
          </button>
          <button className="orbi-btn orbi-btn-primary" onClick={onOpenCreative}>
            <WandSparkles size={13} /> {t('Create')}
          </button>
          <ThemeSwitcher themeMode={themeMode} setThemeMode={setThemeMode} />
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              for (const f of Array.from(e.target.files ?? [])) {
                const dataUrl = await new Promise<string>((r) => {
                  const fr = new FileReader()
                  fr.onload = () => r(String(fr.result))
                  fr.readAsDataURL(f)
                })
                await api.importMedia({ name: f.name, dataUrl })
              }
              e.target.value = ''
              onRefresh()
            }}
          />
        </div>
      </header>

      <div className="studio-gallery-page">
        <aside className="studio-right">
          <div className="studio-boards">
            <div className="studio-panel-head">
              <span>{t('Where it came from')}</span>
            </div>
            <div className="studio-board-list">
              {sources.map((s) => (
                <button key={s.id || 'all'} className={source === s.id ? 'active' : ''} onClick={() => setSource(s.id)}>
                  <s.icon size={13} />
                  <span>{t(s.label)}</span>
                  <em className="num">{s.id ? media.filter((m) => (s.id === 'creative' ? m.source === 'creative' || m.source === 'canvas' : m.source === s.id)).length : media.length}</em>
                </button>
              ))}
            </div>
            <div className="studio-panel-head">
              <span>{t('Boards')}</span>
            </div>
            <div className="studio-board-list">
              <button className={board === '' ? 'active' : ''} onClick={() => setBoard('')}>
                <FolderOpen size={13} />
                <span>{t('All boards')}</span>
                <em className="num">{media.length}</em>
              </button>
              {boards.map((b) => (
                <button key={b.id} className={board === b.id ? 'active' : ''} onClick={() => setBoard(b.id)}>
                  <FolderOpen size={13} />
                  <span>{b.name}</span>
                  <em className="num">{media.filter((m) => m.board === b.id).length}</em>
                </button>
              ))}
            </div>
          </div>
        </aside>
        <section className="studio-gallery-grid">
          <div className="gallery-bar">
            <label className="gallery-search">
              <Search size={14} />
              <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search prompts, names and models')} aria-label={t('Search the library')} />
              {query ? (
                <button onClick={() => setQuery('')} aria-label={t('Clear search')}>
                  <X size={12} />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
            </label>
            <span className="gallery-count num">{t('{n} items', { n: shown.length })}</span>
          </div>
          {shown.length === 0 ? (
            <div className="studio-empty-page">
              {q ? <Search size={22} /> : <ImageIcon size={22} />}
              <p>{q ? t('No match for “{q}”', { q: query.trim() }) : t('Nothing here yet')}</p>
              <span>{q ? t('Try a word from the prompt or the model name.') : t('Generate an image in Creative or the chat, or import files to start your library.')}</span>
            </div>
          ) : (
            shown.map((m, k) => (
              <div key={m.id} className="studio-gallery-item">
                <div className="studio-thumb big" title={m.prompt || m.name}>
                  {m.kind === 'image' ? (
                    <img src={m.url} alt={m.prompt || m.name} loading="lazy" onClick={() => setViewing(k)} />
                  ) : m.kind === 'video' ? (
                    <video src={m.url} muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} onClick={() => setViewing(k)} />
                  ) : (
                    <button className="media-file-tile" onClick={() => setViewing(k)}>
                      {m.kind === 'audio' ? <Music size={22} /> : <FileText size={22} />}
                      <span>{m.name.split('.').pop()?.toUpperCase()}</span>
                    </button>
                  )}
                  <span className={`studio-thumb-kind kind-${m.kind}`}>{m.kind === 'video' ? <Video size={10} /> : m.kind === 'audio' ? <Music size={10} /> : m.kind === 'file' ? <FileText size={10} /> : <ImageIcon size={10} />}</span>
                  <div className="media-tile-tools">
                    {m.kind === 'image' && (
                      <>
                        <button title={hasVideo ? t('Make a video from this image') : t('Download a video model in Models first')} onClick={() => makeVideo(m)}>
                          <Clapperboard size={12} />
                        </button>
                        <button title={hasUpscaler ? t('Upscale 4×') : t('Download an upscaler in Models to enlarge images')} onClick={() => upscale(m)}>
                          <Maximize2 size={12} />
                        </button>
                      </>
                    )}
                    <button title={t('View full screen')} onClick={() => setViewing(k)}>
                      <Maximize size={12} />
                    </button>
                    {m.prompt && (m.kind === 'image' || m.kind === 'video') && (
                      <button
                        title={t('Use prompt')}
                        onClick={() => {
                          sendPromptToCreative(m.prompt, undefined, m.kind === 'video' ? 'video' : 'image')
                          onOpenCreative()
                        }}
                      >
                        <Wand2 size={12} />
                      </button>
                    )}
                    <button title={t('Save as…')} onClick={() => api.saveMediaAs(m.id)}>
                      <Download size={12} />
                    </button>
                    <button title={t('Delete')} onClick={() => remove(m)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <p className="truncate">{m.prompt || m.name}</p>
                <small className="num truncate">
                  {m.model || (m.source === 'upload' ? t('Imported') : '')} · {fmtDate(m.created_at)}
                </small>
              </div>
            ))
          )}
        </section>
      </div>
      {viewing !== null && shown[viewing] && (
        <Lightbox
          items={shown}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onDeleted={onRefresh}
          onUsePrompt={(m, negative) => {
            sendPromptToCreative(m.prompt, negative, m.kind === 'video' ? 'video' : 'image')
            setViewing(null)
            onOpenCreative()
          }}
          onUpscale={upscale}
          onMakeVideo={makeVideo}
          onEdit={(m) => {
            setViewing(null)
            edit(m)
          }}
        />
      )}
      {toast && <div className="media-toast">{toast}</div>}
    </main>
  )
}
