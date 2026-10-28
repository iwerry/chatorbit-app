// First-run setup: name, language and theme, then the right local models for this PC.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, Image as ImageIcon, Loader2, MessageSquareText, Mic, Monitor, Moon, SquareTerminal, Sun, Video, Volume2, X } from 'lucide-react'
import { api, type LocalModel, type LocalStatus, type ModelKind } from '../lib/api'
import { fmtBytes, LANGUAGES, t, type Lang } from '../lib/i18n'
import { OrbiMark } from './Logo'
import { HardwareCard } from './ModelHub'
import type { ThemeMode } from './ThemeSwitcher'

const KINDS: { kind: ModelKind; label: string; hint: string; icon: typeof ImageIcon }[] = [
  { kind: 'text', label: 'Chat', hint: 'Answers, writing and code, offline', icon: MessageSquareText },
  { kind: 'image', label: 'Images', hint: 'Generate and edit images', icon: ImageIcon },
  { kind: 'video', label: 'Video', hint: 'Short clips from text or an image', icon: Video },
  { kind: 'stt', label: 'Voice input', hint: 'Dictate with the microphone', icon: Mic },
  { kind: 'tts', label: 'Read aloud', hint: 'A natural voice for answers and voiceovers', icon: Volume2 },
]

export function SetupWizard({
  status,
  userName,
  setUserName,
  lang,
  setLang,
  themeMode,
  setThemeMode,
  onDone,
  startStep = 0,
}: {
  status: LocalStatus | null
  userName: string
  setUserName: (n: string) => void
  lang: Lang
  setLang: (l: Lang) => void
  themeMode: ThemeMode
  setThemeMode: (m: ThemeMode) => void
  onDone: (opts: { sttModel?: string; ttsModel?: string }) => void
  startStep?: number
}) {
  const [step, setStep] = useState(startStep)
  const [name, setName] = useState(userName)
  const [pick, setPick] = useState<Partial<Record<ModelKind, string>>>({})
  const [include, setInclude] = useState<Partial<Record<ModelKind, boolean>>>({})
  const [started, setStarted] = useState(false)

  // Pre-select the recommended model of each kind once the hardware is known.
  useEffect(() => {
    if (!status || Object.keys(pick).length) return
    const p: Partial<Record<ModelKind, string>> = {}
    const inc: Partial<Record<ModelKind, boolean>> = {}
    for (const { kind } of KINDS) {
      const usable = status.models.filter((m) => m.kind === kind && m.engineSupported && m.tier !== 'custom')
      // Voices: the first one in the user's language.
      const short = lang.slice(0, 2).toLowerCase()
      const pack = kind === 'tts' ? usable.find((m) => m.id === status.recommended.tts && m.voices?.some((v) => v.lang === 'multi' || v.lang.toLowerCase().startsWith(short)))?.id : undefined
      const byLang = kind === 'tts' ? pack || usable.find((m) => m.lang && lang.toLowerCase().startsWith(m.lang.slice(0, 2).toLowerCase()))?.id : undefined
      const rec = byLang || status.recommended[kind] || usable.find((m) => m.fit.level !== 'no')?.id
      if (rec) p[kind] = rec
      inc[kind] = (!!status.recommended[kind] || !!byLang) && usable.length > 0
    }
    setPick(p)
    setInclude(inc)
  }, [status])

  const chosen = useMemo(
    () => KINDS.filter(({ kind }) => include[kind] && pick[kind]).map(({ kind }) => status?.models.find((m) => m.id === pick[kind])).filter((m): m is LocalModel => !!m && !m.installed),
    [include, pick, status],
  )
  const totalBytes = chosen.reduce((a, m) => a + m.size, 0)
  const freeDisk = (status?.hardware?.diskFree ?? 0) * 1e9
  const pending = status ? status.models.filter((m) => m.downloading || status.queue?.includes(m.id)) : []

  const startDownloads = async () => {
    setStarted(true)
    if (chosen.length) await api.enqueueLocal(chosen.map((m) => m.id))
    setStep(2)
  }

  const finish = () => onDone({ sttModel: include.stt ? pick.stt : undefined, ttsModel: include.tts ? pick.tts : undefined })

  return (
    <div className="orbi-modal-backdrop setup-backdrop">
      <div className="setup" role="dialog" aria-label={t('Set up Orbi')}>
        <div className="setup-steps" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>
        {step > 0 && (
          <button className="setup-close" onClick={finish} aria-label={t('Close')}>
            <X size={16} />
          </button>
        )}

        {step === 0 && (
          <section className="setup-page">
            <div className="setup-mark">
              <OrbiMark width={30} height={30} />
            </div>
            <h2>{t('Welcome to Orbi')}</h2>
            <p className="setup-lead">{t('Chat, create images and videos with AI — on this PC or in the cloud. Let’s set things up in a minute.')}</p>
            <label className="orbi-label">{t('Your name')}</label>
            <label className="orbi-field">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Your name')} autoFocus />
            </label>
            <label className="orbi-label">{t('Language')}</label>
            <div className="lang-grid">
              {LANGUAGES.map((l) => (
                <button key={l.id} className={`lang-option ${lang === l.id ? 'active' : ''}`} onClick={() => setLang(l.id)}>
                  {lang === l.id && <Check size={13} />}
                  {l.name}
                </button>
              ))}
            </div>
            <label className="orbi-label">{t('Appearance')}</label>
            <div className="setup-themes">
              {(
                [
                  ['light', 'Light', Sun],
                  ['dark', 'Dark', Moon],
                  ['terminal', 'Terminal', SquareTerminal],
                ] as const
              ).map(([id, label, Icon]) => (
                <button key={id} className={`setup-theme setup-theme-${id} ${themeMode === id ? 'active' : ''}`} onClick={() => setThemeMode(id)}>
                  <span className="setup-theme-preview">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <Icon size={13} /> {t(label)}
                  </span>
                </button>
              ))}
            </div>
            <div className="setup-actions">
              <button className="orbi-btn" onClick={finish}>
                {t('Skip setup')}
              </button>
              <button
                className="orbi-btn orbi-btn-primary"
                onClick={() => {
                  if (name.trim()) {
                    setUserName(name.trim())
                    api.setSetting('userName', name.trim())
                  }
                  setStep(1)
                }}
              >
                {t('Continue')} <ArrowRight size={13} />
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="setup-page">
            <h2>{t('AI that fits your PC')}</h2>
            <p className="setup-lead">{t('We checked your computer and picked the strongest models that run well on it. Everything runs offline and stays free. Change any choice or skip what you don’t need.')}</p>
            {!status ? <div className="hub-skeleton" /> : <HardwareCard status={status} />}
            <div className="setup-kinds">
              {status &&
                KINDS.map(({ kind, label, hint, icon: Icon }) => {
                  const options = status.models.filter((m) => m.kind === kind && m.engineSupported && m.tier !== 'custom')
                  const current = options.find((m) => m.id === pick[kind])
                  const unsupported = !options.length
                  return (
                    <div key={kind} className={`setup-kind ${include[kind] ? 'on' : ''} ${unsupported ? 'off' : ''}`}>
                      <label className="setup-kind-head">
                        <input type="checkbox" checked={!!include[kind]} disabled={unsupported} onChange={(e) => setInclude((c) => ({ ...c, [kind]: e.target.checked }))} />
                        <Icon size={16} />
                        <span>
                          <strong>{t(label)}</strong>
                          <small>{unsupported ? t('Not available on this system yet — use a cloud provider.') : t(hint)}</small>
                        </span>
                      </label>
                      {!unsupported && (
                        <>
                          <select className="ab-input" value={pick[kind] || ''} onChange={(e) => setPick((c) => ({ ...c, [kind]: e.target.value }))} disabled={!include[kind]}>
                            {(['light', 'medium', 'heavy'] as const).map((tier) => {
                              const list = options.filter((m) => m.tier === tier)
                              if (!list.length) return null
                              return (
                                <optgroup key={tier} label={t(tier === 'light' ? 'Light' : tier === 'medium' ? 'Medium' : 'Heavy')}>
                                  {list.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name} · {fmtBytes(m.size)}
                                      {m.installed ? ` · ${t('installed')}` : ''}
                                      {status.recommended[kind] === m.id ? ` · ★ ${t('Recommended')}` : m.fit.level === 'slow' ? ` · ${t('slow here')}` : m.fit.level === 'no' ? ` · ${t('too heavy')}` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              )
                            })}
                          </select>
                          {current && <p className={`hub-fit hub-fit-${current.fit.level}`}><i />{t(current.description)}</p>}
                        </>
                      )}
                    </div>
                  )
                })}
            </div>
            <p className="setup-total num">
              {chosen.length ? t('{n} downloads · {size} · {free} free on disk', { n: chosen.length, size: fmtBytes(totalBytes), free: fmtBytes(freeDisk) }) : t('Nothing to download.')}
            </p>
            {totalBytes > freeDisk && freeDisk > 0 && <p className="studio-error">{t('Not enough free disk space for everything you picked.')}</p>}
            <div className="setup-actions">
              <button className="orbi-btn" onClick={() => setStep(0)}>
                <ArrowLeft size={13} /> {t('Back')}
              </button>
              <button className="orbi-btn" onClick={finish}>
                {t('Use cloud AI only')}
              </button>
              <button className="orbi-btn orbi-btn-primary" disabled={started} onClick={startDownloads}>
                <Download size={13} /> {chosen.length ? t('Download and continue') : t('Continue')}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="setup-page">
            <h2>{pending.length ? t('Downloading your models') : t('All set!')}</h2>
            <p className="setup-lead">
              {pending.length
                ? t('This runs in the background — you can start using Orbi now. Progress also shows in Settings → Local models.')
                : t('Your models are ready. Pick them in the model menu of a chat, or in Creative.')}
            </p>
            <ul className="setup-progress">
              {KINDS.filter(({ kind }) => include[kind] && pick[kind]).map(({ kind, icon: Icon }) => {
                const m = status?.models.find((x) => x.id === pick[kind])
                if (!m) return null
                const pct = m.downloading?.total ? Math.round((m.downloading.received / m.downloading.total) * 100) : 0
                return (
                  <li key={kind}>
                    <Icon size={15} />
                    <span className="min-w-0 flex-1">
                      <strong>{m.name}</strong>
                      <small className="num">{m.installed ? t('Ready') : m.downloading ? `${pct}% · ${fmtBytes(m.downloading.received)} / ${fmtBytes(m.downloading.total)}` : status?.queue?.includes(m.id) ? t('Queued') : t('Waiting')}</small>
                      {!m.installed && (
                        <span className="local-bar">
                          <i style={{ width: `${Math.max(2, pct)}%` }} />
                        </span>
                      )}
                    </span>
                    {m.installed ? <Check size={15} className="setup-ok" /> : <Loader2 size={15} className="animate-spin" />}
                  </li>
                )
              })}
            </ul>
            <p className="setup-tip">
              <Monitor size={13} /> {t('Want the strongest models? Connect a cloud provider anytime in Settings → AI providers.')}
            </p>
            <div className="setup-actions">
              <button className="orbi-btn orbi-btn-primary" onClick={finish}>
                {pending.length ? t('Start using Orbi') : t('Done')}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
