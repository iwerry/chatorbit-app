// One model picker for the whole app (the chat picker's look): search, models grouped by company
// with "Popular" first, Top / Fast / Cheap chips and the price of each model.
// <ModelMenu> is the list; <ModelSelect> is a button that opens it in a floating panel.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { t } from '../lib/i18n'
import { modelTags, priceLabel, useCloud } from '../lib/cloud'

export type MenuUnit = 'M' | 'img' | 's' | 'k' | 'min' | 'song'
export type MenuItem = {
  key: string
  name: string
  /** Small line under the name (usually the model id). */
  sub?: string
  group: string
  featured?: boolean
  /** OpenRouter price in US$ for one unit (per 1M tokens in, per image, per second…). */
  usd?: number
  /** Second price (per 1M tokens out, for text models). */
  usdOut?: number
  unit?: MenuUnit
}

/** Price text for one item: OpenRouter US$ for admins, credits for everyone else. */
export function usePriceText() {
  const { catalog, state } = useCloud()
  const admin = !!state?.user?.admin
  return (usd: number | undefined, unit: MenuUnit, usdOut?: number) =>
    unit === 'song' ? priceLabel(usd, 'img', admin, catalog).replace('/img', `/${t('song')}`) : priceLabel(usd, unit, admin, catalog, usdOut)
}

export function ModelMenu({ items, value, onPick, icon, empty }: { items: MenuItem[]; value?: string; onPick: (key: string) => void; icon?: ReactNode; empty?: string }) {
  const [q, setQ] = useState('')
  const price = usePriceText()
  const [tipIndex, setTipIndex] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => setTipIndex((i) => i + 1), 7000)
    return () => clearInterval(timer)
  }, [])
  const lowest = useMemo(() => [...items].filter((m) => m.usd !== undefined && Number.isFinite(m.usd)).sort((a, b) => (a.usd! + (a.usdOut ?? 0)) - (b.usd! + (b.usdOut ?? 0)))[0], [items])
  const quick = items.find((m) => /flash|lite|mini|turbo|haiku|instant|klein/i.test(`${m.key} ${m.name}`))
  const tip = tipIndex % 2 && quick ? { model: quick, text: t('For quick drafts'), note: t('Suggested by model family; speed varies.') } : lowest ? { model: lowest, text: t('Lowest listed price'), note: lowest.unit ? price(lowest.usd, lowest.unit, lowest.usdOut) || t('Free') : '' } : null
  const tags = useMemo(() => modelTags(items.map((m) => ({ id: m.key, name: m.name, featured: m.featured, cost: m.usd !== undefined ? m.usd + (m.usdOut ?? 0) * 3 : undefined }))), [items])
  const shown = items.filter((m) => `${m.name} ${m.sub || ''} ${m.group}`.toLowerCase().includes(q.toLowerCase()))
  // "Popular" first, then companies in the order they arrive.
  const groups = useMemo(() => {
    const g = [...new Set(shown.map((m) => m.group))]
    const pop = t('Popular')
    return g.includes(pop) ? [pop, ...g.filter((x) => x !== pop)] : g
  }, [shown])
  return (
    <div className="mm">
      <label className="mm-search">
        <Search size={14} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search {n} models', { n: items.length })} />
      </label>
      {!q && tip && <button type="button" className="mm-advice" onClick={() => onPick(tip.model.key)} title={tip.note}>
        <span key={`${tip.text}-${tip.model.key}`}><small>{tip.text}</small><strong>{tip.model.name}</strong><small>{tip.note}</small></span>
      </button>}
      <div className="mm-list">
        {groups.map((g) => (
          <div key={g}>
            <p className="mm-group">{g}</p>
            {shown
              .filter((m) => m.group === g)
              .map((m) => {
                const p = m.unit ? price(m.usd, m.unit, m.usdOut) : ''
                const tg = tags.get(m.key) || []
                return (
                  <button type="button" key={m.key} className={`mm-item ${m.key === value ? 'on' : ''}`} onClick={() => onPick(m.key)}>
                    {icon ? <span className="mm-ico">{icon}</span> : <span className={`model-radio ${m.key === value ? 'model-radio-active' : ''}`} />}
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block truncate">{m.name}</strong>
                      {m.sub && <small className="block truncate">{m.sub}</small>}
                    </span>
                    {(tg.length > 0 || p) && (
                      <span className="model-meta">
                        <span className="model-tags">
                          {tg.map((x) => (
                            <em key={x} className={`model-tag model-tag-${x.toLowerCase()}`}>
                              {t(x)}
                            </em>
                          ))}
                        </span>
                        {p && <small className="num">{p}</small>}
                      </span>
                    )}
                    {m.key === value && <Check size={14} className="mm-check" />}
                  </button>
                )
              })}
          </div>
        ))}
        {!shown.length && <p className="mm-empty">{items.length ? t('No match.') : empty || t('Sign in to your Orbi account to see the models.')}</p>}
      </div>
    </div>
  )
}

/** A button showing the chosen model and its price; opens the picker in a floating panel. */
export function ModelSelect({ items, value, onPick, icon, className = '', placeholder }: { items: MenuItem[]; value?: string; onPick: (key: string) => void; icon?: ReactNode; className?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const price = usePriceText()
  const current = items.find((m) => m.key === value) ?? items[0]
  const place = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(440, Math.max(320, r.width), window.innerWidth - 24)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const below = Math.max(0, window.innerHeight - r.bottom - 20)
    const above = Math.max(0, r.top - 20)
    if (below >= 320 || below >= above) setPos({ left, top: r.bottom + 6, width, maxH: Math.min(520, below) })
    else setPos({ left, bottom: window.innerHeight - r.top + 6, width, maxH: Math.min(520, above) })
  }
  useLayoutEffect(() => {
    if (open) place()
  }, [open])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', place)
    const scroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) place() }
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])
  const p = current?.unit ? price(current.usd, current.unit, current.usdOut) : ''
  return (
    <>
      <button type="button" ref={btn} className={`mm-trigger ${open ? 'open' : ''} ${className}`} onClick={() => setOpen((v) => !v)} onPointerDown={(e) => e.stopPropagation()} aria-expanded={open}>
        {icon && <span className="mm-trigger-ico">{icon}</span>}
        <span className="min-w-0 flex-1 truncate text-left">{current?.name || placeholder || t('Choose a model')}</span>
        {p && <small className="num mm-trigger-price">{p}</small>}
        <ChevronDown size={13} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={panel} className="mm-float" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH, height: pos.maxH }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <ModelMenu
              items={items}
              value={current?.key}
              icon={icon}
              onPick={(k) => {
                onPick(k)
                setOpen(false)
              }}
            />
          </div>,
          document.body,
        )}
    </>
  )
}

/** "≈ 168 credits" (or the OpenRouter US$ for admins) before something is generated. */
export function CostChip({ usd, className = '' }: { usd: number | undefined; className?: string }) {
  const { catalog, state } = useCloud()
  if (usd === undefined || !(usd > 0)) return null
  const admin = !!state?.user?.admin
  const text = admin ? `≈ $${usd >= 1 ? usd.toFixed(2) : usd.toFixed(3)}` : `≈ ${Math.max(1, Math.round((usd * (catalog?.credits.markup ?? 1.25)) / (catalog?.credits.usd ?? 0.001))).toLocaleString()} ${t('credits')}`
  return (
    <span className={`cost-chip num ${className}`} title={t('Estimated cost of this run')}>
      {text}
    </span>
  )
}
