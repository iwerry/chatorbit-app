// The Session: one floating panel on the right that gathers what belongs to the work in progress —
// the conversation's context, the terminal and what the conversation produced. It replaces the old
// right-side context panel, its pull tab and the terminal docked at the bottom.
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Images, PanelRightClose, SquareTerminal, Sparkles } from 'lucide-react'
import { t } from '../lib/i18n'

export type SessionTab = 'context' | 'terminal' | 'outputs'

const TABS: { id: SessionTab; label: string; icon: typeof Sparkles }[] = [
  { id: 'context', label: 'Context', icon: Sparkles },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'outputs', label: 'Outputs', icon: Images },
]

export const SESSION_MIN = 320
export const SESSION_MAX = 720

export function SessionPanel({
  tab,
  onTab,
  width,
  onWidth,
  onClose,
  badges,
  context,
  terminal,
  outputs,
}: {
  tab: SessionTab
  onTab: (t: SessionTab) => void
  width: number
  onWidth: (w: number) => void
  onClose: () => void
  badges?: Partial<Record<SessionTab, number>>
  context: ReactNode
  /** Always mounted so terminals keep running while another tab is shown. */
  terminal: ReactNode
  outputs: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: PointerEvent) => onWidth(Math.min(SESSION_MAX, Math.max(SESSION_MIN, startW - (ev.clientX - startX))))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('panel-is-resizing')
    }
    document.body.classList.add('panel-is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  return (
    <aside className="session" ref={panel} style={{ width }} aria-label={t('Session')}>
      <div
        className="session-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Resize session panel')}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onWidth(Math.min(SESSION_MAX, width + 24))
          if (e.key === 'ArrowRight') onWidth(Math.max(SESSION_MIN, width - 24))
        }}
      />
      <header className="session-head">
        <nav className="session-tabs" role="tablist" aria-label={t('Session')}>
          {TABS.map((x) => {
            const Icon = x.icon
            const n = badges?.[x.id]
            return (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => onTab(x.id)}>
                <Icon size={14} />
                <span>{t(x.label)}</span>
                {!!n && <b className="session-badge num">{n}</b>}
              </button>
            )
          })}
        </nav>
        <button className="icon-button session-close" onClick={onClose} title={t('Hide session (Ctrl+Alt+B)')} aria-label={t('Hide session')}>
          <PanelRightClose size={16} />
        </button>
      </header>
      <div className="session-body" role="tabpanel" hidden={tab !== 'context'}>
        {context}
      </div>
      <div className="session-body session-body-terminal" role="tabpanel" hidden={tab !== 'terminal'}>
        {terminal}
      </div>
      <div className="session-body" role="tabpanel" hidden={tab !== 'outputs'}>
        {outputs}
      </div>
    </aside>
  )
}
