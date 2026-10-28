// One voice library used everywhere a voice is chosen: Settings, Local models, the speaker button
// under answers and the Voice node in Workflows. Choose, listen, install and uninstall in place.
import { useEffect, useMemo, useState } from 'react'
import { X, Check, ChevronDown, Download, ExternalLink, Globe, Loader2, Mic, RefreshCw, Sparkles, Square, Trash2, Upload, Volume2 } from 'lucide-react'
import { api, type LocalModel, type LocalStatus, type NativeVoice, type TtsChoice, type VoiceInfo } from '../lib/api'
import { fmtBytes, getLang, t } from '../lib/i18n'
import { isLocalChoice, sampleFor, speak, stopSpeaking, systemVoices } from '../lib/tts'
import { recordWav } from '../lib/voice'

const cleanErr = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// The voices people ask for most on Hugging Face that still need a Python engine (not bundled yet).
// Voices from the Hugging Face top list that Orbi cannot install automatically yet, and why.
export const ADVANCED_VOICES: { name: string; by: string; repo: string; license: string; nc?: boolean; note: string }[] = [
  { name: 'Fish Speech / OpenAudio S1', by: 'Fish Audio', repo: 'fishaudio/openaudio-s1-mini', license: 'CC-BY-NC-SA-4.0', nc: true, note: 'Gated model (you must accept terms on Hugging Face) and a heavy custom install.' },
  { name: 'ChatTTS', by: '2Noise', repo: '2Noise/ChatTTS', license: 'CC-BY-NC-4.0', nc: true, note: 'Chinese and English only.' },
  { name: 'CosyVoice 2', by: 'Alibaba', repo: 'FunAudioLLM/CosyVoice2-0.5B', license: 'Apache-2.0', note: 'Needs its source repository and many native dependencies.' },
  { name: 'MetaVoice-1B', by: 'MetaVoice', repo: 'metavoiceio/metavoice-1B-v0.1', license: 'Apache-2.0', note: 'English only and no longer maintained.' },
  { name: 'OpenVoice V2', by: 'MyShell', repo: 'myshell-ai/OpenVoiceV2', license: 'MIT', note: 'Needs its source repository and MeloTTS; cloning is covered by Chatterbox and XTTS.' },
  { name: 'MeloTTS', by: 'MyShell', repo: 'myshell-ai/MeloTTS-English', license: 'MIT', note: 'Needs extra dictionaries; Kokoro and Supertonic cover the same ground.' },
]

const LANG_NAME: Record<string, string> = { 'pt-BR': 'Português (BR)', 'en-US': 'English (US)', 'en-GB': 'English (UK)', en: 'English', es: 'Español', fr: 'Français', it: 'Italiano', hi: 'हिन्दी', multi: '31 languages' }

type Mode = 'default' | 'pick'
type Row = { model: LocalModel; voice: VoiceInfo }

function voicesOf(m: LocalModel, clones: { id: string; name: string }[]): VoiceInfo[] {
  if (m.voices?.length) return m.clone ? [...m.voices, ...clones.map((c) => ({ id: c.id, name: c.name, lang: 'en-US', gender: 'f' as const }))] : m.voices
  return [{ id: 0, name: m.name.split(' · ')[0], lang: m.lang || 'en', gender: 'm' }]
}
const sameVoice = (c: TtsChoice | null, m: LocalModel, v: VoiceInfo, first: VoiceInfo) =>
  isLocalChoice(c) && c.modelId === m.id && String(c.voice ?? first.id) === String(v.id)

// The best voice of a pack for a language (top-rated first).
export function defaultVoiceFor(m: LocalModel | undefined, lang: string): number | string | undefined {
  if (!m?.voices?.length) return undefined
  const short = lang.slice(0, 2).toLowerCase()
  const inLang = m.voices.filter((v) => v.lang === 'multi' || v.lang.toLowerCase().startsWith(short))
  return (inLang.find((v) => v.top) || inLang[0] || m.voices.find((v) => v.top) || m.voices[0]).id
}

export function choiceLabel(c: TtsChoice | null, status: LocalStatus | null): string {
  if (!c) return t('System voice')
  if (c.type === 'system' || c.type === 'native') return c.name
  const m = status?.models.find((x) => x.id === c.modelId)
  if (!m) return t('Voice')
  const v = voicesOf(m, status?.clones || []).find((x) => String(x.id) === String(c.voice ?? '')) || voicesOf(m, status?.clones || [])[0]
  return m.voices?.length ? `${v?.name} · ${m.name.split(' · ')[0]}` : m.name
}

export function VoiceLibrary({
  status,
  onLocalChanged,
  mode = 'default',
  value,
  onPick,
  compact = false,
  extra,
  hideSystem = false,
}: {
  status: LocalStatus | null
  onLocalChanged: () => void
  mode?: Mode
  value?: TtsChoice | null
  onPick?: (c: TtsChoice) => void
  compact?: boolean
  extra?: React.ReactNode
  hideSystem?: boolean
}) {
  const lang = getLang()
  const short = lang.slice(0, 2).toLowerCase()
  const [saved, setSaved] = useState<TtsChoice | null>(null)
  const [rate, setRate] = useState(1)
  const [playing, setPlaying] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [allLangs, setAllLangs] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [sys, setSys] = useState<SpeechSynthesisVoice[]>(systemVoices())
  const [native, setNative] = useState<{ voices: NativeVoice[]; hint: string | null; platform: string } | null>(null)
  const loadNative = (refresh = false) => api.systemVoices(refresh).then(setNative).catch(() => setNative({ voices: [], hint: null, platform: '' }))
  useEffect(() => {
    loadNative()
  }, [])
  const choice = mode === 'pick' ? (value ?? null) : saved

  useEffect(() => {
    api.getSetting<TtsChoice | null>('ttsVoice', null).then((c) => {
      setSaved(c)
      if (c?.rate) setRate(c.rate)
    })
    const update = () => setSys(systemVoices())
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = update
    update()
    return () => stopSpeaking()
  }, [])

  const choose = (c: TtsChoice) => {
    if (mode === 'pick') return onPick?.(c)
    setSaved(c)
    api.setSetting('ttsVoice', c)
    onPick?.(c)
  }
  const listen = async (key: string, c: TtsChoice, sampleLang: string) => {
    if (playing === key) {
      stopSpeaking()
      setPlaying(null)
      return
    }
    setErr(null)
    setPlaying(key)
    try {
      await speak(sampleFor(sampleLang), c, sampleLang)
    } catch (e) {
      setErr(cleanErr(e))
    } finally {
      setPlaying((p) => (p === key ? null : p))
    }
  }
  const install = async (m: LocalModel) => {
    if (m.licenseNotice && !confirm(t(m.licenseNotice) + '\n\n' + t('Accept and install?'))) return
    if (m.engine === 'python' && !confirm(t('{name} installs a private copy of Python and PyTorch (about {size}). It can take 10–30 minutes. Continue?', { name: m.name, size: fmtBytes(m.size) }))) return
    setBusy(m.id)
    setErr(null)
    try {
      await api.installLocalModel(m.id)
      onLocalChanged()
      setOpen((o) => ({ ...o, [m.id]: true }))
      // First natural voice on this PC: make it the default in the user's language.
      if (mode === 'default' && (!saved || saved.type === 'system')) choose({ type: 'local', modelId: m.id, voice: defaultVoiceFor(m, lang), rate })
    } catch (e) {
      setErr(cleanErr(e))
    } finally {
      setBusy(null)
    }
  }
  const remove = async (m: LocalModel) => {
    if (!confirm(t('Remove {name} from this computer? You can download it again anytime.', { name: m.name }))) return
    await api.removeLocal(m.id)
    if (isLocalChoice(saved) && saved.modelId === m.id && mode === 'default') {
      setSaved(null)
      api.setSetting('ttsVoice', null)
    }
    onLocalChanged()
  }

  const fitsLang = (v: VoiceInfo) => allLangs || v.lang === 'multi' || v.lang.toLowerCase().startsWith(short)
  // Packs first (most natural), then single Piper voices in the user's language.
  const models = useMemo(() => {
    const all = status?.models.filter((m) => m.kind === 'tts' && m.engineSupported) ?? []
    const rank = (m: LocalModel) => (status?.recommended.tts === m.id ? 0 : m.engine === 'python' ? 2 : m.voices?.length ? 1 : 3)
    return all
      .filter((m) => allLangs || m.voices?.length || (m.lang || '').toLowerCase().startsWith(short) || m.installed)
      .sort((a, b) => rank(a) - rank(b) || Number(b.installed) - Number(a.installed))
  }, [status, allLangs, short])
  const sysShown = sys.filter((v) => allLangs || v.lang.toLowerCase().startsWith(short)).slice(0, allLangs ? 60 : compact ? 4 : 8)
  const nativeAll = native?.voices ?? []
  const nativeShown = nativeAll.filter((v) => allLangs || v.lang.toLowerCase().startsWith(short)).slice(0, allLangs ? 200 : compact ? 6 : 12)
  const useNative = nativeAll.length > 0
  const addMore =
    native?.platform === 'win32'
      ? t('Add voices in Windows Settings → Time & language → Speech → Add voices.')
      : native?.platform === 'darwin'
        ? t('Add voices in System Settings → Accessibility → Spoken Content → System voice → Manage voices.')
        : native?.hint
          ? t('Install a speech engine with: {cmd}', { cmd: native.hint })
          : t('More voices: install espeak-ng or pico2wave from your distribution.')

  return (
    <div className={`voice-lib ${compact ? 'compact' : ''}`}>
      <div className="voice-lib-top">
        <label className="studio-slider voice-rate">
          <span>{t('Speed')}</span>
          <input
            type="range"
            min={0.7}
            max={1.6}
            step={0.05}
            value={rate}
            onChange={(e) => {
              const r = Number(e.target.value)
              setRate(r)
              if (choice) choose({ ...choice, rate: r })
            }}
          />
          <span className="num">{rate.toFixed(2)}×</span>
        </label>
        <button className="link-btn text-[12px]" onClick={() => setAllLangs((v) => !v)}>
          {allLangs ? t('Show only my language') : t('Show all languages')}
        </button>
      </div>

      <div className="voice-option">
        <div className="voice-option-head">
          <Sparkles size={16} />
          <div>
            <strong>{t('Natural voices (offline)')}</strong>
            <small>{t('Download once, then they run on this PC for free. Listen before you choose.')}</small>
          </div>
        </div>
        {models.map((m) => {
          const voices = voicesOf(m, status?.clones || [])
          // Best-rated voices first; long packs show 6 until expanded.
          const matching = voices.filter(fitsLang).sort((a, b) => Number(!!b.top) - Number(!!a.top))
          const shown = more[m.id] ? matching : matching.slice(0, 6)
          const first = voices[0]
          const pct = m.downloading?.total ? Math.round((m.downloading.received / m.downloading.total) * 100) : 0
          const isOpen = open[m.id] ?? (m.installed && (!compact || voices.some((v) => sameVoice(choice, m, v, first))))
          const multi = (m.voices?.length || 0) > 1 || m.clone
          return (
            <div key={m.id} className={`voice-pack ${m.installed ? 'installed' : ''}`}>
              <div className="voice-pack-head">
                <button className="voice-pack-title" onClick={() => setOpen((o) => ({ ...o, [m.id]: !isOpen }))} disabled={!m.installed || !multi}>
                  <strong>{m.name}</strong>
                  {status?.recommended.tts === m.id && <span className="hub-badge hub-badge-rec">{t('Recommended')}</span>}
                  {m.nonCommercial && <span className="hub-badge hub-badge-warn">{t('Non-commercial')}</span>}
                  {m.engine === 'python' && <span className="hub-badge">Python · Hugging Face</span>}
                  {m.clone && <span className="hub-badge">{t('Voice cloning')}</span>}
                  <small>
                    {t(m.description)} · <span className="num">{fmtBytes(m.size)}</span> · {m.license}
                    {multi ? ` · ${t('{n} voices', { n: voices.length })}` : ''}
                  </small>
                  {m.downloading && (
                    <span className="local-bar mt-1">
                      <i style={{ width: `${Math.max(3, pct)}%` }} />
                    </span>
                  )}
                </button>
                {m.installed ? (
                  <>
                    {!multi && (
                      <>
                        <button className="orbi-btn" onClick={() => listen(m.id, { type: 'local', modelId: m.id, rate }, m.lang || lang)}>
                          {playing === m.id ? <Square size={11} /> : <Volume2 size={13} />} {t('Listen')}
                        </button>
                        <button className={`orbi-btn ${sameVoice(choice, m, first, first) ? 'orbi-btn-primary' : ''}`} onClick={() => choose({ type: 'local', modelId: m.id, rate })}>
                          {sameVoice(choice, m, first, first) ? <Check size={13} /> : null} {sameVoice(choice, m, first, first) ? (mode === 'pick' ? t('Chosen') : t('Default')) : t('Use')}
                        </button>
                      </>
                    )}
                    {multi && (
                      <button className="icon-button" onClick={() => setOpen((o) => ({ ...o, [m.id]: !isOpen }))} aria-label={t('Show voices')}>
                        <ChevronDown size={15} className={isOpen ? 'rotate-180' : ''} />
                      </button>
                    )}
                    <button className="icon-button" title={t('Uninstall')} onClick={() => remove(m)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : m.downloading ? (
                  <button className="orbi-btn" onClick={() => api.cancelLocal(m.id).then(onLocalChanged)}>
                    <Loader2 size={13} className="animate-spin" /> {pct}% · {t('Cancel')}
                  </button>
                ) : (
                  <button className={`orbi-btn ${status?.recommended.tts === m.id ? 'orbi-btn-primary' : ''}`} disabled={!!busy} onClick={() => install(m)}>
                    {busy === m.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('Install')}
                  </button>
                )}
              </div>
              {m.installed && multi && isOpen && (
                <div className="voice-pack-voices">
                  {shown.map((v) => {
                    const key = `${m.id}:${v.id}`
                    const c: TtsChoice = { type: 'local', modelId: m.id, voice: v.id, rate }
                    const active = sameVoice(choice, m, v, first)
                    const sampleLang = v.lang === 'multi' ? lang : v.lang
                    const isClone = typeof v.id === 'string' && v.id.startsWith('clone-')
                    return (
                      <div key={key} className={`voice-model ${active ? 'active' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <strong>
                            {v.name} {v.top && <span className="voice-top">★</span>}
                          </strong>
                          <small>
                            {LANG_NAME[v.lang] || v.lang} · {v.gender === 'f' ? t('female') : t('male')}
                            {isClone ? ` · ${t('your clone')}` : ''}
                          </small>
                        </div>
                        <button className="orbi-btn" onClick={() => listen(key, c, sampleLang)}>
                          {playing === key ? <Square size={11} /> : <Volume2 size={13} />} {t('Listen')}
                        </button>
                        <button className={`orbi-btn ${active ? 'orbi-btn-primary' : ''}`} onClick={() => choose(c)}>
                          {active ? <Check size={13} /> : null} {active ? (mode === 'pick' ? t('Chosen') : t('Default')) : t('Use')}
                        </button>
                        {isClone && (
                          <button className="icon-button" title={t('Delete')} onClick={() => api.deleteVoiceClone(String(v.id)).then(onLocalChanged)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {matching.length > shown.length && (
                    <button className="link-btn self-start text-[12px]" onClick={() => setMore((o) => ({ ...o, [m.id]: true }))}>
                      {t('Show all {n} voices', { n: matching.length })}
                    </button>
                  )}
                  {!shown.length && <p className="hub-note">{t('No voices in your language in this pack. Use “Show all languages”.')}</p>}
                  {m.clone && <CloneVoice onSaved={onLocalChanged} />}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="voice-option">
        <div className="voice-option-head">
          <Globe size={16} />
          <div>
            <strong>{t('System voices')}</strong>
            <small>{t('Already on your computer (Windows, macOS or Linux). Nothing to download. License: your operating system’s.')}</small>
          </div>
          <button className="icon-button ml-auto" title={t('Refresh')} onClick={() => loadNative(true)}>
            <RefreshCw size={13} />
          </button>
        </div>
        {useNative &&
          nativeShown.map((v) => {
            const active = choice?.type === 'native' && choice.id === v.id
            const c: TtsChoice = { type: 'native', id: v.id, name: v.name, rate }
            return (
              <div key={v.id} className={`voice-model ${active ? 'active' : ''}`}>
                <div className="min-w-0 flex-1">
                  <strong className="truncate">{v.name}</strong>
                  <small>
                    {v.lang} · {v.engine}
                    {v.gender ? ` · ${v.gender === 'f' ? t('female') : t('male')}` : ''}
                  </small>
                </div>
                <button className="orbi-btn" onClick={() => listen(v.id, c, v.lang)}>
                  {playing === v.id ? <Square size={11} /> : <Volume2 size={13} />} {t('Listen')}
                </button>
                <button className={`orbi-btn ${active ? 'orbi-btn-primary' : ''}`} onClick={() => choose(c)}>
                  {active ? <Check size={13} /> : null} {active ? (mode === 'pick' ? t('Chosen') : t('Default')) : t('Use')}
                </button>
              </div>
            )
          })}
        {!useNative &&
          !hideSystem &&
          sysShown.map((v) => {
            const active = choice?.type === 'system' && choice.name === v.name
            const c: TtsChoice = { type: 'system', name: v.name, rate }
            return (
              <div key={v.name} className={`voice-model ${active ? 'active' : ''}`}>
                <div className="min-w-0 flex-1">
                  <strong className="truncate">{v.name}</strong>
                  <small>{v.lang}</small>
                </div>
                <button className="orbi-btn" onClick={() => listen(v.name, c, v.lang)}>
                  {playing === v.name ? <Square size={11} /> : <Volume2 size={13} />} {t('Listen')}
                </button>
                <button className={`orbi-btn ${active ? 'orbi-btn-primary' : ''}`} onClick={() => choose(c)}>
                  {active ? <Check size={13} /> : null} {active ? (mode === 'pick' ? t('Chosen') : t('Default')) : t('Use')}
                </button>
              </div>
            )
          })}
        {native && (useNative ? !nativeShown.length : !sysShown.length) && <p className="hub-note">{t('No system voices for this language.')}</p>}
        {native && <p className="hub-note">{addMore}</p>}
      </div>

      {extra}

      {!compact && (
        <details className="voice-option voice-advanced">
          <summary className="voice-option-head">
            <Sparkles size={16} />
            <div>
              <strong>{t('Other Hugging Face voices')}</strong>
              <small>{t('Popular open voices Orbi does not install automatically yet, and why.')}</small>
            </div>
          </summary>
          {ADVANCED_VOICES.map((v) => (
            <div key={v.repo} className="voice-model">
              <div className="min-w-0 flex-1">
                <strong>
                  {v.name} <span className="hub-meta">{v.by}</span>
                </strong>
                <small>
                  {t(v.note)} · {v.license}
                  {v.nc ? ` · ${t('non-commercial')}` : ''}
                </small>
              </div>
              <button className="orbi-btn" onClick={() => api.openExternal(`https://huggingface.co/${v.repo}`)}>
                Hugging Face <ExternalLink size={12} />
              </button>
            </div>
          ))}
        </details>
      )}
      {err && <p className="provider-status provider-status-error">{err}</p>}
    </div>
  )
}

// Record (or upload) 5–10 seconds of a voice to clone it with Pocket TTS.
function CloneVoice({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('')
  const [stopFn, setStopFn] = useState<null | (() => Promise<string>)>(null)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!stopFn) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [stopFn])
  const save = async (wav: string) => {
    setBusy(true)
    try {
      await api.saveVoiceClone({ name: name.trim() || t('My voice'), wav })
      setName('')
      onSaved()
    } catch (e) {
      setErr(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }
  const toggle = async () => {
    setErr(null)
    if (stopFn) {
      const wav = await stopFn()
      setStopFn(null)
      return save(wav)
    }
    try {
      const fn = await recordWav()
      setStopFn(() => fn)
      setStarted(Date.now())
      setNow(Date.now())
    } catch (e) {
      setErr(cleanErr(e))
    }
  }
  const upload = (file: File | undefined) => {
    if (!file) return
    const r = new FileReader()
    r.onload = () => save(String(r.result).split(',')[1] || '')
    r.readAsDataURL(file)
  }
  const secs = stopFn ? Math.floor((now - started) / 1000) : 0
  return (
    <div className="voice-clone">
      <p>
        <strong>{t('Clone a voice')}</strong> — {t('Read any text out loud for 5–10 seconds in a quiet room. Only clone your own voice or a voice you have permission to use.')}
      </p>
      <div className="voice-clone-row">
        <input className="ab-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Voice name')} />
        <button className={`orbi-btn ${stopFn ? 'orbi-btn-primary' : ''}`} onClick={toggle} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : stopFn ? <Square size={11} /> : <Mic size={13} />}
          {stopFn ? `${t('Stop and save')} · ${secs}s` : t('Record')}
        </button>
        <label className="orbi-btn">
          <Upload size={13} /> {t('Upload WAV')}
          <input type="file" accept="audio/wav,.wav" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {err && <p className="provider-status provider-status-error">{err}</p>}
    </div>
  )
}

// A compact button that shows the current voice and opens the library in a dialog.
export function VoiceButton({ status, onLocalChanged, value, onPick, extra, label, hideSystem }: { status: LocalStatus | null; onLocalChanged: () => void; value: TtsChoice | null; onPick: (c: TtsChoice) => void; extra?: React.ReactNode; label?: string; hideSystem?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="ab-input voice-button" onClick={() => setOpen(true)}>
        <Volume2 size={13} /> <span className="truncate">{label || choiceLabel(value, status)}</span> <ChevronDown size={13} />
      </button>
      {open && (
        <VoiceDialog title={t('Choose a voice')} onClose={() => setOpen(false)}>
          <VoiceLibrary
            status={status}
            onLocalChanged={onLocalChanged}
            mode="pick"
            value={value}
            onPick={(c) => {
              onPick(c)
            }}
            compact
            extra={extra}
            hideSystem={hideSystem}
          />
        </VoiceDialog>
      )}
    </>
  )
}

export function VoiceDialog({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="orbi-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="voice-dialog voice-dialog-wide" role="dialog" aria-label={title}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
