import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { OrbiMark } from './Logo'
import { platform } from '../lib/api'

export type Command = {
  id: string
  label: string
  shortcut?: string
  run: () => void
  enabled?: boolean
  checked?: boolean
  category?: string
}

export type MenuItem = string | '-' | { label: string; submenu: (string | '-')[] }
export type MenuDef = { label: string; items: MenuItem[] }

export const isMac = platform === 'darwin'
export function prettyShortcut(s?: string) {
  if (!s) return ''
  return isMac ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s
}

function MenuList({ items, commands, onDone, sub = false }: { items: MenuItem[]; commands: Record<string, Command>; onDone: () => void; sub?: boolean }) {
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <div className={`tb-menu ${sub ? 'tb-submenu' : ''}`} role="menu">
      {items.map((it, i) => {
        if (it === '-') return <div key={i} className="tb-sep" />
        if (typeof it === 'object') {
          return (
            <div key={i} className="tb-item tb-has-sub" onMouseEnter={() => setOpenSub(it.label)} onMouseLeave={() => setOpenSub(null)}>
              <span className="tb-check" />
              <span className="tb-label">{it.label}</span>
              <ChevronRight size={13} />
              {openSub === it.label && <MenuList items={it.submenu} commands={commands} onDone={onDone} sub />}
            </div>
          )
        }
        const c = commands[it]
        if (!c) return null
        const disabled = c.enabled === false
        return (
          <button
            key={i}
            className="tb-item"
            role="menuitem"
            disabled={disabled}
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => {
              onDone()
              setTimeout(c.run, 0)
            }}
          >
            <span className="tb-check">{c.checked && <Check size={12} />}</span>
            <span className="tb-label">{c.label}</span>
            <span className="tb-shortcut">{prettyShortcut(c.shortcut)}</span>
          </button>
        )
      })}
    </div>
  )
}

export function TitleBar({ menus, commands, title, onLogo }: { menus: MenuDef[]; commands: Record<string, Command>; title: string; onLogo: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`titlebar ${isMac ? 'titlebar-mac' : ''}`} ref={ref}>
      <button className="tb-logo" onClick={onLogo} title="Orbi" aria-label="Orbi home">
        <OrbiMark width={15} height={15} />
      </button>
      <nav className="tb-menus" aria-label="Application menu">
        {menus.map((m) => (
          <div key={m.label} className="tb-menu-root">
            <button
              className={`tb-menu-btn ${open === m.label ? 'active' : ''}`}
              onClick={() => setOpen(open === m.label ? null : m.label)}
              onMouseEnter={() => open && setOpen(m.label)}
              aria-haspopup="menu"
              aria-expanded={open === m.label}
            >
              {m.label}
            </button>
            {open === m.label && <MenuList items={m.items} commands={commands} onDone={() => setOpen(null)} />}
          </div>
        ))}
      </nav>
      <div className="tb-title">{title}</div>
      <div className="tb-controls-space" />
    </div>
  )
}

export function CommandPalette({
  commands,
  conversations,
  initialMode,
  onClose,
  onOpenConversation,
}: {
  commands: Command[]
  conversations: { id: string; title: string }[]
  initialMode: 'commands' | 'chats'
  onClose: () => void
  onOpenConversation: (id: string) => void
}) {
  const [q, setQ] = useState(initialMode === 'commands' ? '>' : '')
  const [idx, setIdx] = useState(0)
  const mode = q.startsWith('>') ? 'commands' : 'chats'
  const term = q.replace(/^>/, '').trim().toLowerCase()
  const items =
    mode === 'commands'
      ? commands
          .filter((c) => c.enabled !== false && `${c.category ?? ''} ${c.label}`.toLowerCase().includes(term))
          .map((c) => ({ key: c.id, label: c.category ? `${c.category}: ${c.label}` : c.label, hint: prettyShortcut(c.shortcut), run: c.run }))
      : conversations
          .filter((c) => c.title.toLowerCase().includes(term))
          .slice(0, 50)
          .map((c) => ({ key: c.id, label: c.title, hint: 'chat', run: () => onOpenConversation(c.id) }))

  useEffect(() => setIdx(0), [q])

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          value={q}
          placeholder={mode === 'commands' ? 'Type a command' : 'Search chats by name (type > for commands)'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(items.length - 1, i + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(0, i - 1))
            }
            if (e.key === 'Enter' && items[idx]) {
              onClose()
              setTimeout(items[idx].run, 0)
            }
          }}
        />
        <div className="palette-list">
          {items.length === 0 && <p className="palette-empty">No matching {mode === 'commands' ? 'commands' : 'chats'}</p>}
          {items.map((it, i) => (
            <button
              key={it.key}
              className={i === idx ? 'active' : ''}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                onClose()
                setTimeout(it.run, 0)
              }}
            >
              <span>{it.label}</span>
              <small>{it.hint}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FindBar({ onClose, find, stop, result }: { onClose: () => void; find: (t: string, next: boolean, forward: boolean) => void; stop: () => void; result: { matches: number; active: number } | null }) {
  const [text, setText] = useState('')
  useEffect(() => () => stop(), [])
  return (
    <div className="find-bar">
      <input
        autoFocus
        placeholder="Find in chat"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          find(e.target.value, false, true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter') find(text, true, !e.shiftKey)
        }}
      />
      <span>{result && text ? `${result.active} of ${result.matches}` : 'No results'}</span>
      <button onClick={() => find(text, true, false)} aria-label="Previous match">
        ↑
      </button>
      <button onClick={() => find(text, true, true)} aria-label="Next match">
        ↓
      </button>
      <button onClick={onClose} aria-label="Close find">
        ✕
      </button>
    </div>
  )
}
