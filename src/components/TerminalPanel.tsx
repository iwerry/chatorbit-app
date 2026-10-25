import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ChevronDown, Maximize2, Minimize2, Plus, Trash2, X } from 'lucide-react'
import { api, on, uid } from '../lib/api'

type Session = { id: string; shell: string; exited?: boolean }

export type TerminalHandle = {
  newTerminal: () => void
  killActive: () => void
  clear: () => void
  run: (text: string, execute?: boolean) => void
}

const THEME = {
  background: '#141414',
  foreground: '#d8dee0',
  cursor: '#c8f04a',
  cursorAccent: '#141414',
  selectionBackground: '#3a4a2a',
  black: '#1b1f1d',
  red: '#ef7d7d',
  green: '#a5cd70',
  yellow: '#e6c46e',
  blue: '#75a8c8',
  magenta: '#b99ad0',
  cyan: '#75bdc8',
  white: '#d8dee0',
  brightBlack: '#5b6660',
  brightRed: '#ff9b9b',
  brightGreen: '#c8f04a',
  brightYellow: '#f5d98b',
  brightBlue: '#9cc6e0',
  brightMagenta: '#d2b8e6',
  brightCyan: '#9fdde6',
  brightWhite: '#ffffff',
}

function TermView({ session, active, onExit }: { session: Session; active: boolean; onExit: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const xterm = useRef<XTerm | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    const term = new XTerm({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    })
    const f = new FitAddon()
    term.loadAddon(f)
    term.open(host.current!)
    xterm.current = term
    fit.current = f
    try {
      f.fit()
    } catch {
      /* hidden */
    }
    ;(window as any).__orbiTerms = { ...((window as any).__orbiTerms || {}), [session.id]: term }
    const offData = on('term:data', (id: string, data: string) => id === session.id && term.write(data))
    const offExit = on('term:exit', (id: string) => {
      if (id !== session.id) return
      term.write('\r\n\x1b[2m[process exited — press + for a new terminal]\x1b[0m\r\n')
      onExit(id)
    })
    const d = term.onData((data) => api.termWrite(session.id, data))
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C / Ctrl+Shift+V copy & paste like VS Code
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        navigator.clipboard.writeText(term.getSelection())
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        navigator.clipboard.readText().then((t) => api.termWrite(session.id, t))
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && e.code === 'KeyC' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      return true
    })
    api.termCreate({ id: session.id, cols: term.cols, rows: term.rows }).catch((e) => term.write(`\x1b[31m${String(e.message || e)}\x1b[0m\r\n`))
    const ro = new ResizeObserver(() => {
      try {
        f.fit()
        api.termResize(session.id, term.cols, term.rows)
      } catch {
        /* not visible */
      }
    })
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      d.dispose()
      offData()
      offExit()
      term.dispose()
    }
  }, [session.id])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fit.current?.fit()
          if (xterm.current) api.termResize(session.id, xterm.current.cols, xterm.current.rows)
        } catch {
          /* ignore */
        }
        xterm.current?.focus()
      })
    }
  }, [active])

  return <div ref={host} className="term-host" style={{ display: active ? 'block' : 'none' }} />
}

export const TerminalPanel = forwardRef<TerminalHandle, { height: number; setHeight: (h: number) => void; onClose: () => void; maximized: boolean; setMaximized: (v: boolean) => void }>(
  function TerminalPanel({ height, setHeight, onClose, maximized, setMaximized }, ref) {
    const [sessions, setSessions] = useState<Session[]>([])
    const [active, setActive] = useState<string | null>(null)
    const [shellName, setShellName] = useState('shell')
    const [error, setError] = useState<string | null>(null)

    const newTerminal = () => {
      const s = { id: uid(), shell: shellName }
      setSessions((cur) => [...cur, s])
      setActive(s.id)
    }

    useEffect(() => {
      api.termInfo().then((i) => {
        setShellName(i.shell)
        if (!i.available) setError(i.error || 'Terminal is not available on this system.')
      })
    }, [])
    useEffect(() => {
      if (sessions.length === 0 && shellName !== 'shell') newTerminal()
    }, [shellName])

    const kill = (id: string) => {
      api.termKill(id)
      setSessions((cur) => {
        const next = cur.filter((s) => s.id !== id)
        if (active === id) setActive(next[next.length - 1]?.id ?? null)
        if (next.length === 0) setTimeout(onClose, 0)
        return next
      })
    }

    useImperativeHandle(ref, () => ({
      newTerminal,
      killActive: () => active && kill(active),
      clear: () => {
        const t = active && (window as any).__orbiTerms?.[active]
        t?.clear()
      },
      run: (text: string, execute = false) => {
        if (!active) return
        const clean = text.replace(/\r?\n$/, '')
        const payload = clean.includes('\n') ? clean.replace(/\r?\n/g, '\r') : clean
        api.termWrite(active, payload + (execute ? '\r' : ''))
        ;(window as any).__orbiTerms?.[active]?.focus()
      },
    }))

    const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startY = e.clientY
      const startH = height
      const move = (ev: PointerEvent) => setHeight(Math.min(window.innerHeight - 160, Math.max(120, startH - (ev.clientY - startY))))
      const stop = () => {
        document.body.classList.remove('panel-is-resizing')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
      }
      document.body.classList.add('panel-is-resizing')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
    }

    return (
      <section className="terminal-panel" style={{ height }}>
        <div className="term-resize" onPointerDown={startResize} />
        <header className="term-header">
          <div className="term-tabs-left">
            <span className="term-title">Terminal</span>
            {sessions.map((s, i) => (
              <button key={s.id} className={`term-tab ${s.id === active ? 'active' : ''} ${s.exited ? 'exited' : ''}`} onClick={() => setActive(s.id)}>
                <span className="term-dot" />
                {s.shell}
                {sessions.length > 1 ? ` ${i + 1}` : ''}
                <span
                  role="button"
                  className="term-tab-x"
                  onClick={(e) => {
                    e.stopPropagation()
                    kill(s.id)
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            ))}
          </div>
          <div className="term-actions">
            <span className="term-shell">
              {shellName} <ChevronDown size={12} />
            </span>
            <button onClick={newTerminal} title="New terminal (Ctrl+Shift+`)">
              <Plus size={15} />
            </button>
            <button onClick={() => active && kill(active)} title="Kill terminal">
              <Trash2 size={14} />
            </button>
            <button onClick={() => setMaximized(!maximized)} title={maximized ? 'Restore panel' : 'Maximize panel'}>
              {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button onClick={onClose} title="Hide panel (Ctrl+`)">
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="term-body">
          {error && <p className="term-error">{error}</p>}
          {sessions.map((s) => (
            <TermView key={s.id} session={s} active={s.id === active} onExit={(id) => setSessions((cur) => cur.map((x) => (x.id === id ? { ...x, exited: true } : x)))} />
          ))}
        </div>
      </section>
    )
  },
)
