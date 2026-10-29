// Pieces of the chat composer: the typewriter placeholder that teaches commands, the command guide,
// the thinking-effort slider, the microphone/speaker menu, the live recording bar,
// the Image/Video create bar and the media card that shows renders inside the chat.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUp,
  AudioLines,
  Blocks,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock3,
  Download,
  Film,
  Gem,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  MessageSquareText,
  Mic,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Speaker,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import { api, type MediaItem } from '../lib/api'
import { t } from '../lib/i18n'
import { aspectInfo, aspectsFor, estimateUsd, imageResValue, nearestAspect, ratio, resLabel, type CreativeOption } from '../lib/creative'
import { creativeBus, type ChatMediaMeta, type GenUpdate } from '../lib/creativeBus'
import { CLOUD_ONLY, fmtCredits, nearestDuration } from '../lib/cloud'
import { setAudioPref, useAudioDevices } from '../lib/audioDevices'
import type { Recording } from '../lib/voice'
import { Lightbox } from './Lightbox'
import { CostChip, ModelMenu } from './ModelMenu'
import { creativeItems } from '../lib/menuItems'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/* ------------------------------------------------------------------ */
/* Popover shell                                                       */
/* ------------------------------------------------------------------ */

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), close())
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])
  return ref
}

/** A control with a panel that rises above it. */
export function PopPill({
  label,
  icon,
  title,
  active,
  wide,
  align = 'left',
  className = '',
  children,
}: {
  label: ReactNode
  icon?: ReactNode
  title: string
  active?: boolean
  wide?: boolean
  align?: 'left' | 'right'
  className?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(wide ? 440 : 320, window.innerWidth - 24)
      const above = r.top - 20
      const below = window.innerHeight - r.bottom - 20
      const up = above > below
      const maxHeight = Math.max(0, Math.min(480, up ? above : below))
      setPosition({ position: 'fixed', width, minWidth: 0, left: Math.max(12, Math.min(align === 'right' ? r.right - width : r.left, window.innerWidth - width - 12)), top: up ? undefined : r.bottom + 8, bottom: up ? window.innerHeight - r.top + 8 : undefined, right: 'auto', maxHeight, height: wide ? maxHeight : undefined, zIndex: 650 })
    }
    place()
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); ref.current?.querySelector('button')?.focus() }
    }
    const scroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) place() }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open, wide, align])
  return (
    <div className={`cpill-wrap ${className}`} ref={ref}>
      <button type="button" className={`cpill ${open ? 'open' : ''} ${active ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" title={title}>
        {icon}
        <span className="cpill-label">{label}</span>
        <ChevronDown size={12} className="cpill-caret" />
      </button>
      {open && createPortal(
        <div ref={panel} style={position} className={`cpop cpop-viewport ${wide ? 'cpop-wide' : ''} cpop-${align}`} role="dialog" aria-label={title}>
          {children(() => setOpen(false))}
        </div>
      , document.body)}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Typewriter placeholder                                              */
/* ------------------------------------------------------------------ */

export type Example = { parts: { text: string; kind?: 'cmd' | 'agent' | 'arg' }[]; insert: string; note: string }

/** Types example prompts one character at a time while the box is empty, teaching / and @. */
export function TypewriterHint({ examples, onCurrent }: { examples: Example[]; onCurrent?: (e: Example) => void }) {
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(0)
  const [phase, setPhase] = useState<'type' | 'hold' | 'erase'>('type')
  const ex = examples[i % Math.max(examples.length, 1)]
  const full = ex ? ex.parts.map((p) => p.text).join('') : ''
  useEffect(() => {
    if (ex) onCurrent?.(ex)
  }, [i, examples])
  useEffect(() => {
    if (!ex) return
    if (reduced()) {
      setShown(full.length)
      const tm = setTimeout(() => setI((n) => n + 1), 4200)
      return () => clearTimeout(tm)
    }
    let tm: ReturnType<typeof setTimeout>
    if (phase === 'type') {
      if (shown < full.length) tm = setTimeout(() => setShown((n) => n + 1), full[shown] === ' ' ? 28 : 34 + Math.random() * 40)
      else tm = setTimeout(() => setPhase('hold'), 60)
    } else if (phase === 'hold') tm = setTimeout(() => setPhase('erase'), i === 0 ? 1600 : 2600)
    else if (shown > 0) tm = setTimeout(() => setShown((n) => Math.max(0, n - 2)), 14)
    else
      tm = setTimeout(() => {
        setI((n) => n + 1)
        setPhase('type')
      }, 260)
    return () => clearTimeout(tm)
  }, [phase, shown, full])
  if (!ex) return null
  let left = shown
  return (
    <div className="typewriter" aria-hidden>
      <span className="typewriter-text">
        {ex.parts.map((p, k) => {
          const take = Math.max(0, Math.min(p.text.length, left))
          left -= p.text.length
          return take ? (
            <span key={k} className={p.kind ? `tw-${p.kind}` : undefined}>
              {p.text.slice(0, take)}
            </span>
          ) : null
        })}
        <span className="tw-caret" />
      </span>
      {phase === 'hold' && ex.insert && (
        <span className="tw-hint">
          <kbd>Tab</kbd> {ex.note}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Command guide: details for the / skill or @ agent being typed        */
/* ------------------------------------------------------------------ */

export type CommandInfo = {
  kind: 'skill' | 'agent' | 'team' | 'command'
  token: string
  name: string
  description: string
  usage: string
  meta?: string
  subcommands: { cmd: string; desc: string }[]
  starters: string[]
}

export function CommandGuide({ info, onInsert, onClose }: { info: CommandInfo; onInsert: (text: string) => void; onClose: () => void }) {
  const Icon = info.kind === 'skill' ? Blocks : info.kind === 'command' ? Sparkles : Bot
  return (
    <div className="cmd-guide" role="note">
      <div className="cmd-guide-head">
        <span className={`cmd-guide-icon k-${info.kind}`}>
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p>
            <strong>{info.token}</strong>
            {info.name.replace(/^[@/]/, '').toLowerCase() !== info.token.slice(1).toLowerCase() && <span>{info.name}</span>}
            {info.meta && <em>{info.meta}</em>}
          </p>
          {info.description && <small>{info.description}</small>}
        </div>
        <button type="button" className="cmd-guide-x" onClick={onClose} aria-label={t('Hide')}>
          <X size={12} />
        </button>
      </div>
      <code className="cmd-guide-usage">{info.usage}</code>
      {(info.subcommands.length > 0 || info.starters.length > 0) && (
        <div className="cmd-guide-chips">
          {info.subcommands.map((s) => (
            <button type="button" key={s.cmd} onClick={() => onInsert(`${s.cmd} `)} title={s.desc}>
              <b>{s.cmd}</b>
              <span>{s.desc}</span>
            </button>
          ))}
          {info.starters.slice(0, 3).map((s) => (
            <button type="button" key={s} onClick={() => onInsert(`"${s}"`)} className="starter">
              <ChevronRight size={11} />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Pulls "init — what it does" style commands from skill or agent instructions. */
export function parseSubcommands(text: string, token: string): { cmd: string; desc: string }[] {
  const out: { cmd: string; desc: string }[] = []
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inline = new RegExp(`${esc}\\s+([a-z][\\w-]{1,20})\\b[^\\n]{0,4}?(?:[—–:-]\\s*([^\\n]{3,90}))?`, 'gi')
  for (const m of text.matchAll(inline)) if (!out.some((o) => o.cmd === m[1])) out.push({ cmd: m[1], desc: (m[2] || '').replace(/[`*]/g, '').trim() })
  const section = text.match(/#+\s*(?:commands?|sub-?commands?|modes?|comandos?)\b[^\n]*\n([\s\S]{0,1600}?)(?:\n#|$)/i)
  if (section)
    for (const line of section[1].split('\n')) {
      const m = line.match(/^\s*[-*|]?\s*`?(?:[/@][\w-]+\s+)?([a-z][\w-]{1,20})`?\s*[|—–:-]\s*([^|\n]{3,90})/i)
      if (m && !out.some((o) => o.cmd === m[1])) out.push({ cmd: m[1], desc: m[2].replace(/[`*]/g, '').trim() })
    }
  return out.slice(0, 6)
}

/* ------------------------------------------------------------------ */
/* Thinking effort slider                                              */
/* ------------------------------------------------------------------ */

export const EFFORT_STOPS = ['Instant', 'Fast', 'Medium', 'High'] as const
export type EffortStop = (typeof EFFORT_STOPS)[number]
const EFFORT_NOTE: Record<EffortStop, string> = {
  Instant: 'Answers right away.',
  Fast: 'Thinks briefly before answering.',
  Medium: 'Thinks through the problem first.',
  High: 'Thinks longest — best for hard problems.',
}

export function EffortControl({ value, onChange, model }: { value: EffortStop; onChange: (v: EffortStop) => void; model?: string }) {
  const idx = EFFORT_STOPS.indexOf(value)
  const label = value === 'Instant' ? t('Instant') : `${t('Thinking')} · ${t(value)}`
  return (
    <PopPill label={label} title={t('Response behavior')} className="effort-pill" align="right">
      {() => (
        <div className="effort-pop">
          <p className="effort-pop-title">
            <strong key={value}>{t(value)}</strong>
          </p>
          <div
            className="effort-track"
            role="slider"
            tabIndex={0}
            aria-label={t('Thinking effort')}
            aria-valuemin={0}
            aria-valuemax={EFFORT_STOPS.length - 1}
            aria-valuenow={idx}
            aria-valuetext={t(value)}
            style={{ ['--f' as string]: idx / (EFFORT_STOPS.length - 1) }}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
              if (!d) return
              e.preventDefault()
              onChange(EFFORT_STOPS[Math.max(0, Math.min(EFFORT_STOPS.length - 1, idx + d))])
            }}
            onPointerDown={(e) => {
              const el = e.currentTarget
              const set = (x: number) => {
                const r = el.getBoundingClientRect()
                const k = Math.round(((x - r.left - 13) / (r.width - 26)) * (EFFORT_STOPS.length - 1))
                onChange(EFFORT_STOPS[Math.max(0, Math.min(EFFORT_STOPS.length - 1, k))])
              }
              set(e.clientX)
              el.setPointerCapture(e.pointerId)
              const move = (ev: PointerEvent) => set(ev.clientX)
              const up = () => {
                el.removeEventListener('pointermove', move)
                el.removeEventListener('pointerup', up)
              }
              el.addEventListener('pointermove', move)
              el.addEventListener('pointerup', up)
            }}
          >
            <span className="effort-fill" />
            {EFFORT_STOPS.map((s, i) => (
              <span key={s} className={`effort-dot ${i <= idx ? 'on' : ''}`} style={{ left: `calc(13px + (100% - 26px) * ${i / (EFFORT_STOPS.length - 1)})` }} />
            ))}
            <span className="effort-knob" />
          </div>
          <div className="effort-labels">
            {EFFORT_STOPS.map((s) => (
              <button type="button" key={s} className={s === value ? 'on' : ''} onClick={() => onChange(s)}>
                {t(s)}
              </button>
            ))}
          </div>
          <small className="effort-note">
            {t(EFFORT_NOTE[value])}
            {value !== 'Instant' && model ? ` ${t('Used on models that support it ({model}).', { model })}` : ''}
          </small>
        </div>
      )}
    </PopPill>
  )
}

/* ------------------------------------------------------------------ */
/* Microphone + speaker menu                                           */
/* ------------------------------------------------------------------ */

export function AudioMenu({ onVoiceSettings, onTest }: { onVoiceSettings: () => void; onTest?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const dev = useAudioDevices(open)
  return (
    <div className="cpill-wrap mic-menu-wrap" ref={ref}>
      <button type="button" className={`microphone-menu ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={t('Microphone and speaker')} title={t('Microphone and speaker')}>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="cpop cpop-right audio-pop" role="dialog" aria-label={t('Microphone and speaker')}>
          <p className="cpop-head">
            <Mic size={12} /> {t('Microphone')}
          </p>
          {dev.inputs.length ? (
            <DeviceList list={dev.inputs} value={dev.prefs.input} onPick={(id) => setAudioPref('input', id)} />
          ) : (
            <p className="cpop-note">{t('No microphone found. Plug one in (USB, headset or audio interface) and it shows up here. You can still type.')}</p>
          )}
          <p className="cpop-head">
            <Speaker size={12} /> {t('Speaker')}
          </p>
          {dev.canPickOutput ? (
            <DeviceList list={dev.outputs} value={dev.prefs.output} onPick={(id) => setAudioPref('output', id)} />
          ) : (
            <p className="cpop-note">{t('This system picks the speaker itself.')}</p>
          )}
          <p className="cpop-note">{t('Plug in a USB interface or headset and it shows up here.')}</p>
          <div className="cpop-foot">
            {onTest && (
              <button type="button" onClick={onTest}>
                <Speaker size={12} /> {t('Test speaker')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onVoiceSettings()
              }}
            >
              <Settings2 size={12} /> {CLOUD_ONLY ? t('Voices and dictation…') : t('Dictation engine…')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DeviceList({ list, value, onPick }: { list: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  const has = !value || list.some((d) => d.id === value)
  return (
    <div className="device-list" role="radiogroup">
      {[{ id: '', label: t('System default') }, ...list].map((d) => {
        const on = d.id === value || (!has && !d.id)
        return (
          <button type="button" role="radio" aria-checked={on} key={d.id || 'default'} className={on ? 'on' : ''} onClick={() => onPick(d.id)}>
            <span className="device-radio" />
            <span className="truncate">{d.label}</span>
            {on && <Check size={12} />}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Live recording bar                                                  */
/* ------------------------------------------------------------------ */

export function RecordingBar({ rec, started, onCancel, onStop, onSend }: { rec: Recording; started: number; onCancel: () => void; onStop: () => void; onSend: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let raf = 0
    let last = 0
    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw)
      if (ts - last < 33) return
      last = ts
      setNow(Date.now())
      const c = canvas.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w * dpr) {
        c.width = w * dpr
        c.height = h * dpr
      }
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const css = getComputedStyle(c)
      const col = css.getPropertyValue('--wave').trim() || '#bce64a'
      const dim = css.getPropertyValue('--wave-dim').trim() || 'rgba(160,170,165,.35)'
      const gap = 5
      const n = Math.floor(w / gap)
      const lv = rec.levels(n)
      for (let i = 0; i < n; i++) {
        const v = lv[i]
        const bar = Math.max(2, v * (h - 4))
        ctx.fillStyle = v > 0.04 ? col : dim
        const x = i * gap + 1
        ctx.beginPath()
        ctx.roundRect(x, (h - bar) / 2, 2.4, bar, 1.2)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [rec])
  const secs = Math.floor((now - started) / 1000)
  return (
    <div className="rec-bar" role="group" aria-label={t('Recording')}>
      <button type="button" className="rec-btn" onClick={onCancel} aria-label={t('Cancel recording')} title={t('Cancel')}>
        <X size={16} />
      </button>
      <canvas ref={canvas} className="rec-wave" aria-hidden />
      <span className="rec-time num">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </span>
      <button type="button" className="rec-btn" onClick={onStop} aria-label={t('Stop and edit the text')} title={t('Stop and edit the text')}>
        <Square size={12} fill="currentColor" />
      </button>
      <button type="button" className="send-button rec-send" onClick={onSend} aria-label={t('Stop and send')} title={t('Stop and send')}>
        <ArrowUp size={18} strokeWidth={2.4} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chat · Image · Video switch and the create bar                      */
/* ------------------------------------------------------------------ */

export type ComposeMode = 'chat' | 'image' | 'video'
export type CreateSettings = { modelKey: Record<'image' | 'video', string>; aspect: Record<'image' | 'video', string>; res: Record<'image' | 'video', number>; duration: number; count: number; audio?: boolean }
export const DEFAULT_CREATE: CreateSettings = { modelKey: { image: '', video: '' }, aspect: { image: '1:1', video: '16:9' }, res: { image: 0, video: 0 }, duration: 3, count: 1 }

export function ModeSwitch({ mode, onMode }: { mode: ComposeMode; onMode: (m: ComposeMode) => void }) {
  const items: { id: ComposeMode; label: string; icon: typeof ImageIcon }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquareText },
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'video', label: 'Video', icon: Clapperboard },
  ]
  const idx = items.findIndex((i) => i.id === mode)
  return (
    <div className="mode-switch" role="tablist" aria-label={t('What to make')} style={{ ['--i' as string]: idx }}>
      <span className="mode-switch-thumb" aria-hidden />
      {items.map((it) => (
        <button type="button" role="tab" aria-selected={mode === it.id} key={it.id} className={mode === it.id ? 'on' : ''} onClick={() => onMode(it.id)} title={t(it.label)}>
          <it.icon size={13} />
          <span>{t(it.label)}</span>
        </button>
      ))}
    </div>
  )
}

function AspectIcon({ id }: { id: string }) {
  const a = ratio(id)
  const k = 12 / Math.max(a.w, a.h)
  return <span className="aspect-ico" style={{ width: Math.max(5, a.w * k), height: Math.max(5, a.h * k) }} />
}

export function CreateControls({
  mode,
  options,
  settings,
  setSettings,
  resolutions,
  onOpenModels,
  enhancing,
  onEnhance,
}: {
  mode: 'image' | 'video'
  options: CreativeOption[]
  settings: CreateSettings
  setSettings: (f: (s: CreateSettings) => CreateSettings) => void
  resolutions: number[]
  onOpenModels: () => void
  enhancing: boolean
  onEnhance: () => void
}) {
  const list = options.filter((o) => o.kind === mode)
  const current = list.find((o) => o.key === settings.modelKey[mode]) ?? list[0]
  const res = settings.res[mode] && resolutions.includes(settings.res[mode]) ? settings.res[mode] : resolutions[Math.min(1, resolutions.length - 1)]
  const set = <K extends keyof CreateSettings>(k: K, v: CreateSettings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  // Each model has its own aspect ratios: switching models keeps the closest shape.
  const aspects = aspectsFor(current)
  const aspect = nearestAspect(aspects, settings.aspect[mode])
  useEffect(() => {
    if (aspect !== settings.aspect[mode]) setSettings((s) => ({ ...s, aspect: { ...s.aspect, [mode]: aspect } }))
  }, [aspect, mode])
  return (
    <div className="create-controls">
      <PopPill label={current?.label ?? t('No model')} icon={mode === 'video' ? <Film size={13} /> : <ImageIcon size={13} />} title={t('Change model')} wide className="model-pill">
        {(close) => <ModelPickerPop list={list} current={current?.key} mode={mode} onPick={(k) => (set('modelKey', { ...settings.modelKey, [mode]: k }), close())} onOpenModels={() => (close(), onOpenModels())} />}
      </PopPill>
      <PopPill label={aspect} icon={<AspectIcon id={aspect} />} title={t('Aspect ratio')}>
        {(close) => <AspectList list={aspects} value={aspect} onPick={(a) => (set('aspect', { ...settings.aspect, [mode]: a }), close())} />}
      </PopPill>
      {mode === 'video' && current?.video && (
        <PopPill label={`${nearestDuration(current.video.durations, settings.duration)}s`} icon={<Clock3 size={13} />} title={t('Duration')}>
          {(close) => (
            <div className="cpop-list">
              <p className="cpop-head">{t('Duration')}</p>
              {current.video!.durations.map((d) => (
                <button type="button" key={d} className={d === nearestDuration(current.video!.durations, settings.duration) ? 'on' : ''} onClick={() => (set('duration', d), close())}>
                  <span className="num">{d}s</span>
                  {current.video!.pricePerSecond ? <small className="num">≈ {fmtCredits(Math.ceil(current.video!.pricePerSecond * d))} {t('credits')}</small> : null}
                </button>
              ))}
            </div>
          )}
        </PopPill>
      )}
      {mode === 'video' && !current?.video && (
        <PopPill label={`${settings.duration}s`} icon={<Clock3 size={13} />} title={t('Duration')}>
          {() => (
            <div className="cpop-slider">
              <p className="cpop-head">
                {t('Duration')} <b className="num">{settings.duration}s</b>
              </p>
              <input type="range" min={1} max={10} step={1} value={settings.duration} onChange={(e) => set('duration', Number(e.target.value))} style={{ ['--fill' as string]: `${((settings.duration - 1) / 9) * 100}%` }} />
              <small>{t('Longer clips take much longer to render on this PC.')}</small>
            </div>
          )}
        </PopPill>
      )}
      <PopPill label={resLabel(res)} icon={<Gem size={13} />} title={t('Resolution')}>
        {(close) => (
          <div className="cpop-list">
            <p className="cpop-head">{t('Resolution')}</p>
            {resolutions.map((r) => (
              <button type="button" key={r} className={r === res ? 'on' : ''} onClick={() => (set('res', { ...settings.res, [mode]: r }), close())}>
                <span className="num">{mode === 'image' ? imageResValue(r) : resLabel(r)}</span>
                {r === res && <Check size={13} />}
              </button>
            ))}
          </div>
        )}
      </PopPill>
      {mode === 'video' && current?.video?.audio && (
        <button type="button" className={`cpill ${settings.audio !== false ? 'on' : ''}`} aria-pressed={settings.audio !== false} onClick={() => set('audio', settings.audio === false)} title={t('Generate sound with the video')}>
          <AudioLines size={13} />
          <span className="cpill-label">{t('Audio')}</span>
        </button>
      )}
      <button type="button" className={`cpill enhance-chip ${enhancing ? 'busy' : ''}`} onClick={onEnhance} disabled={enhancing} title={t('Rewrite the prompt with more detail (magic wand)')}>
        {enhancing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
        <span className="cpill-label">{t('Enhance prompt')}</span>
      </button>
      <CostChip usd={estimateUsd(current, { count: mode === 'image' ? settings.count : 1, seconds: mode === 'video' && current?.video ? nearestDuration(current.video.durations, settings.duration) : settings.duration, res })} />
      {mode === 'image' && (
        <div className="batch-stepper" title={t('Results per press')}>
          <button type="button" onClick={() => set('count', Math.max(1, settings.count - 1))} disabled={settings.count <= 1} aria-label={t('Fewer results')}>
            <Minus size={12} />
          </button>
          <span role="spinbutton" aria-valuemin={1} aria-valuemax={4} aria-valuenow={settings.count} aria-label={t('Results per press')} className="num">
            {settings.count}
            <small>/4</small>
          </span>
          <button type="button" onClick={() => set('count', Math.min(4, settings.count + 1))} disabled={settings.count >= 4} aria-label={t('More results')}>
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Aspect ratios a model accepts: shape, ratio, what it is for and an example size. */
export function AspectList({ list, value, onPick }: { list: string[]; value: string; onPick: (a: string) => void }) {
  return (
    <div className="cpop-list aspect-list">
      <p className="cpop-head">{t('Aspect ratio')} · {t('this model')}</p>
      {list.map((a) => {
        const info = aspectInfo(a)
        return (
          <button type="button" key={a} className={a === value ? 'on' : ''} onClick={() => onPick(a)}>
            <span className="aspect-ico-box">
              <AspectIcon id={a} />
            </span>
            <span className="num aspect-id">{a}</span>
            <span className="aspect-text">
              <strong>{t(info.name)}</strong>
              {info.use && <small>{t(info.use)}</small>}
            </span>
            {info.px && <small className="num aspect-px">{info.px}</small>}
            {a === value && <Check size={13} />}
          </button>
        )
      })}
    </div>
  )
}

function ModelPickerPop({ list, current, mode, onPick, onOpenModels }: { list: CreativeOption[]; current?: string; mode: 'image' | 'video'; onPick: (k: string) => void; onOpenModels: () => void }) {
  return (
    <div className="model-pop">
      <ModelMenu items={creativeItems(list)} value={current} onPick={onPick} icon={mode === 'video' ? <Film size={14} /> : <ImageIcon size={14} />} empty={mode === 'video' ? t('No video model is installed yet.') : t('No image model is installed yet.')} />
      {!CLOUD_ONLY && (
        <button type="button" className="model-pop-more" onClick={onOpenModels}>
          <Plus size={13} /> {t('Get more models')}
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Media made from the chat                                            */
/* ------------------------------------------------------------------ */

export function ChatMediaCard({
  meta,
  media,
  onOpenCreative,
  onRetry,
  onAsk,
  onUsePrompt,
  onDeleted,
}: {
  meta: ChatMediaMeta
  onUsePrompt?: (m: MediaItem) => void
  onDeleted?: (m: MediaItem) => void
  media: MediaItem[]
  onOpenCreative: () => void
  onRetry: () => void
  onAsk: (r: { mode: 'video' | 'upscale'; item: MediaItem }) => void
}) {
  const [live, setLive] = useState<GenUpdate | undefined>(() => creativeBus.state(meta.req))
  useEffect(() => creativeBus.subscribe((u) => u.id === meta.req && setLive(u)), [meta.req])
  const [viewing, setViewing] = useState<number | null>(null)
  const items = useMemo(() => {
    const ids = meta.ids.length ? meta.ids : (live?.media ?? []).map((m) => m.id)
    return ids.map((id) => media.find((m) => m.id === id) ?? live?.media?.find((m) => m.id === id)).filter((m): m is MediaItem => !!m)
  }, [meta.ids, live, media])
  const status = meta.error ? 'error' : meta.ids.length ? 'done' : (live?.status ?? 'queued')
  const total = live?.total || meta.count || 1
  const pct = Math.round((live?.progress ?? 0) * 100)
  const waiting = Math.max(0, total - items.length)
  const ratio = (meta.aspect || (meta.mode === 'video' ? '16:9' : '1:1')).replace(':', ' / ')
  const kindLabel = meta.mode === 'video' ? t('Video') : meta.mode === 'upscale' ? t('Upscale 4×') : t('Image')
  return (
    <div className={`chat-media chat-media-${status}`}>
      <div className="chat-media-head">
        {meta.mode === 'video' ? <Film size={13} /> : meta.mode === 'upscale' ? <Maximize2 size={13} /> : <ImageIcon size={13} />}
        <span>
          {kindLabel} · {meta.model}
        </span>
        {(status === 'queued' || status === 'running') && (
          <em className="num">
            {status === 'queued' ? t('Waiting in the Creative queue') : pct > 0 ? t('Rendering… {n}%', { n: pct }) : t('Rendering…')}
          </em>
        )}
        <button type="button" onClick={onOpenCreative} title={t('Open in Creative')}>
          {t('Creative')} <ChevronRight size={11} />
        </button>
      </div>
      {status === 'error' && !items.length ? (
        <div className="chat-media-error">
          <p>{t(meta.error || live?.error || 'The render failed.')}</p>
          {/credit/i.test(meta.error || live?.error || '') && (
            <button type="button" className="orbi-btn orbi-btn-primary" onClick={() => window.dispatchEvent(new Event('orbi:open-account'))}>
              {t('Plans and credits')}
            </button>
          )}
          <button type="button" className="orbi-btn" onClick={onRetry}>
            <RotateCcw size={12} /> {t('Try again')}
          </button>
        </div>
      ) : (
        <div className={`chat-media-grid n${Math.min(total, 4)}`}>
          {items.map((m, k) => (
            <div key={m.id} className="chat-media-tile" style={{ aspectRatio: ratio }}>
              <button type="button" className="chat-media-open" onClick={() => setViewing(k)} aria-label={t('View full screen')}>
                {m.kind === 'video' ? <video src={m.url} muted loop autoPlay playsInline /> : <img src={m.url} alt={m.prompt || m.name} loading="lazy" />}
              </button>
              <div className="chat-media-tools">
                {m.kind === 'image' && (
                  <>
                    <button type="button" onClick={() => onAsk({ mode: 'video', item: m })} title={t('Make a video from this image')}>
                      <Clapperboard size={13} />
                    </button>
                    <button type="button" onClick={() => onAsk({ mode: 'upscale', item: m })} title={t('Upscale 4×')}>
                      <Maximize2 size={13} />
                    </button>
                  </>
                )}
                <button type="button" onClick={() => api.saveMediaAs(m.id)} title={t('Save as…')}>
                  <Download size={13} />
                </button>
              </div>
            </div>
          ))}
          {(status === 'queued' || status === 'running') &&
            Array.from({ length: waiting }, (_, k) => (
              <div key={`w${k}`} className="chat-media-tile chat-media-wait" style={{ aspectRatio: ratio }}>
                <span className="chat-media-shimmer" />
                <span className="chat-media-pct num">{status === 'running' && pct > 0 ? `${pct}%` : <Loader2 size={14} className="animate-spin" />}</span>
                <span className="chat-media-bar" style={{ width: `${Math.max(4, pct)}%` }} />
              </div>
            ))}
        </div>
      )}
      {viewing !== null && items[viewing] && (
        <Lightbox
          items={items}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onUpscale={(m) => onAsk({ mode: 'upscale', item: m })}
          onMakeVideo={(m) => onAsk({ mode: 'video', item: m })}
          onDeleted={onDeleted}
          onUsePrompt={
            onUsePrompt &&
            ((m) => {
              setViewing(null)
              onUsePrompt(m)
            })
          }
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Rotating hint under the box                                         */
/* ------------------------------------------------------------------ */

export function RotatingHint({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0)
  const key = lines.join('|')
  useEffect(() => setI(0), [key])
  useEffect(() => {
    if (lines.length < 2 || reduced()) return
    const tm = setInterval(() => setI((n) => n + 1), 4200)
    return () => clearInterval(tm)
  }, [key])
  const line = lines[i % Math.max(lines.length, 1)] || ''
  return (
    <span className="rotating-hint" aria-live="off">
      <span key={line} className="rotating-hint-line">
        {line.split(/(\[[^\]]+\])/).map((p, k) => (p.startsWith('[') ? <kbd key={k}>{p.slice(1, -1)}</kbd> : <span key={k}>{p}</span>))}
      </span>
    </span>
  )
}

/* Sits exactly over the textarea (same padding, font and line height) so overlays line up with typed text. */
export function InputOverlay({ area, children, className = '' }: { area: React.RefObject<HTMLTextAreaElement | null>; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const a = area.current
    const g = ref.current
    if (!a || !g) return
    const cs = getComputedStyle(a)
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize', 'fontFamily', 'lineHeight', 'letterSpacing', 'fontWeight'] as const) g.style[p] = cs[p]
    g.style.top = `${a.offsetTop}px`
    g.style.left = `${a.offsetLeft}px`
    g.style.width = `${a.offsetWidth}px`
    g.style.minHeight = `${a.offsetHeight}px`
  })
  return (
    <div className={`input-overlay ${className}`} ref={ref} aria-hidden>
      {children}
    </div>
  )
}

export function GhostText({ value, ghost }: { value: string; ghost: string }) {
  if (!ghost) return null
  return (
    <span className="ghost-text">
      <span className="ghost-typed">{value}</span>
      <span className="ghost-rest">{ghost}</span>
    </span>
  )
}
