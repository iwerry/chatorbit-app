// Full-screen media viewer: big image or video, previous/next with the arrow keys or the film strip,
// zoom with a click, slideshow, and the same actions as the library tiles.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, FolderOpen, Info, Pause, Play, Trash2, Wand2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { api, type MediaItem } from '../lib/api'
import { fmtDate, t } from '../lib/i18n'

type Props = {
  items: MediaItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onUsePrompt?: (m: MediaItem, negative?: string) => void
  onDeleted?: (m: MediaItem) => void
}

const paramsOf = (m: MediaItem): Record<string, unknown> => {
  try {
    return m.params ? JSON.parse(m.params) : {}
  } catch {
    return {}
  }
}

export function Lightbox({ items, index, onIndex, onClose, onUsePrompt, onDeleted }: Props) {
  const [zoom, setZoom] = useState(false)
  const [info, setInfo] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [copied, setCopied] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  const count = items.length
  const i = Math.min(Math.max(index, 0), Math.max(count - 1, 0))
  const m = items[i]
  const go = (d: number) => count && onIndex((i + d + count) % count)

  useEffect(() => {
    setZoom(false)
    setCopied(false)
    stripRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && typeof el.closest === 'function' && el.closest('input, textarea, select')) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
      else if (e.key === 'Home') onIndex(0)
      else if (e.key === 'End') onIndex(count - 1)
      else if (e.key.toLowerCase() === 'i') setInfo((v) => !v)
      else if (e.key === ' ' && m?.kind === 'image') {
        e.preventDefault()
        setPlaying((v) => !v)
      } else return
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    if (!playing || count < 2) return
    const tm = setTimeout(() => go(1), 3500)
    return () => clearTimeout(tm)
  }, [playing, i, count])

  if (!m) return null
  const p = paramsOf(m)
  const negative = typeof p.negative === 'string' ? p.negative : ''
  const size = p.width && p.height ? `${p.width} × ${p.height}` : ''

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('Viewer')} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <header className="lightbox-top">
        <span className="lightbox-count num">
          {i + 1} / {count}
        </span>
        <strong className="truncate">{m.name}</strong>
        <span className="flex-1" />
        {m.kind === 'image' && (
          <>
            <button onClick={() => setZoom((v) => !v)} title={zoom ? t('Fit to screen') : t('Actual size')}>
              {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            </button>
            {count > 1 && (
              <button onClick={() => setPlaying((v) => !v)} title={playing ? t('Pause slideshow') : t('Slideshow')} className={playing ? 'active' : ''}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
            )}
          </>
        )}
        <button onClick={() => setInfo((v) => !v)} title={t('Details (I)')} className={info ? 'active' : ''}>
          <Info size={16} />
        </button>
        <button onClick={() => api.saveMediaAs(m.id)} title={t('Save as…')}>
          <Download size={16} />
        </button>
        <button onClick={() => api.openMedia(m.id)} title={t('Open in another app')}>
          <ExternalLink size={16} />
        </button>
        <button onClick={() => api.revealMedia(m.id)} title={t('Show in folder')}>
          <FolderOpen size={16} />
        </button>
        <button
          onClick={async () => {
            if (!confirm(t('Delete this file from the library?'))) return
            await api.deleteMedia(m.id)
            onDeleted?.(m)
            if (count <= 1) onClose()
            else if (i >= count - 1) onIndex(i - 1)
          }}
          title={t('Delete')}
        >
          <Trash2 size={16} />
        </button>
        <button onClick={onClose} title={t('Close (Esc)')} aria-label={t('Close')}>
          <X size={18} />
        </button>
      </header>

      <div className="lightbox-main">
        <div className={`lightbox-stage ${zoom ? 'zoomed' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
          {m.kind === 'image' ? (
            <img key={m.id} src={m.url} alt={m.prompt || m.name} draggable={false} onClick={() => setZoom((v) => !v)} />
          ) : m.kind === 'video' ? (
            <video key={m.id} src={m.url} controls autoPlay loop />
          ) : m.kind === 'audio' ? (
            <div className="lightbox-file">
              <FileText size={40} />
              <audio key={m.id} src={m.url} controls autoPlay />
            </div>
          ) : (
            <div className="lightbox-file">
              <FileText size={40} />
              <span>{m.name.split('.').pop()?.toUpperCase()}</span>
            </div>
          )}
          {count > 1 && (
            <>
              <button className="lightbox-nav prev" onClick={() => go(-1)} aria-label={t('Previous')}>
                <ChevronLeft size={26} />
              </button>
              <button className="lightbox-nav next" onClick={() => go(1)} aria-label={t('Next')}>
                <ChevronRight size={26} />
              </button>
            </>
          )}
        </div>

        {info && (
          <aside className="lightbox-info">
            {m.prompt ? (
              <>
                <p className="lightbox-label">{t('Prompt')}</p>
                <p className="lightbox-prompt">{m.prompt}</p>
              </>
            ) : (
              <p className="lightbox-label">{t('No prompt saved for this file.')}</p>
            )}
            {negative && (
              <>
                <p className="lightbox-label">{t('Negative prompt')}</p>
                <p className="lightbox-prompt neg">{negative}</p>
              </>
            )}
            <dl>
              {m.model && (
                <>
                  <dt>{t('Model')}</dt>
                  <dd>{m.model}</dd>
                </>
              )}
              {size && (
                <>
                  <dt>{t('Size')}</dt>
                  <dd className="num">{size}</dd>
                </>
              )}
              {p.steps ? (
                <>
                  <dt>{t('Steps')}</dt>
                  <dd className="num">{String(p.steps)}</dd>
                </>
              ) : null}
              {p.seed !== undefined && p.seed !== null && p.seed !== '' ? (
                <>
                  <dt>{t('Seed')}</dt>
                  <dd className="num">{String(p.seed)}</dd>
                </>
              ) : null}
              <dt>{t('Created')}</dt>
              <dd>{fmtDate(m.created_at)}</dd>
            </dl>
            {m.prompt && (
              <div className="lightbox-actions">
                {onUsePrompt && (
                  <button className="orbi-btn orbi-btn-primary" onClick={() => onUsePrompt(m, negative || undefined)}>
                    <Wand2 size={13} /> {t('Use prompt')}
                  </button>
                )}
                <button
                  className="orbi-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(m.prompt)
                    setCopied(true)
                  }}
                >
                  <Copy size={13} /> {copied ? t('Copied') : t('Copy prompt')}
                </button>
              </div>
            )}
            <p className="lightbox-keys">{t('← → to browse · Space for slideshow · Esc to close')}</p>
          </aside>
        )}
      </div>

      {count > 1 && (
        <div className="lightbox-strip" ref={stripRef}>
          {items.map((x, k) => (
            <button key={x.id} data-i={k} className={k === i ? 'active' : ''} onClick={() => onIndex(k)} aria-label={x.name}>
              {x.kind === 'image' ? <img src={x.url} alt="" loading="lazy" draggable={false} /> : x.kind === 'video' ? <video src={x.url} muted preload="metadata" /> : <FileText size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
