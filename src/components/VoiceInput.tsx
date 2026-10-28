// Voice input (speech to text): choose, test, install and uninstall the model — used in Settings,
// Local models and from the microphone button.
import { useEffect, useState } from 'react'
import { Check, Globe, Loader2, Mic, Square, Trash2 } from 'lucide-react'
import { api, type LocalStatus, type ProviderInfo, type VoiceMode } from '../lib/api'
import { recordWav } from '../lib/voice'
import { getLang, t } from '../lib/i18n'

const cleanErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function VoiceSettings({ status, onLocalChanged, onPicked }: { status: LocalStatus | null; onLocalChanged: () => void; onPicked?: (m: VoiceMode) => void }) {
  const [mode, setMode] = useState<VoiceMode | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getSetting<VoiceMode | null>('voiceMode', null).then(setMode)
    api.providers().then(setProviders)
  }, [])
  const pick = (m: VoiceMode) => {
    setMode(m)
    api.setSetting('voiceMode', m)
    onPicked?.(m)
  }
  const stt = status?.models.filter((m) => m.kind === 'stt') ?? []
  const localSupported = !!status?.engines.whisper.supported
  const rec = status?.recommended.stt
  const keyed = (id: string) => providers.find((p) => p.id === id)?.hasKey
  return (
    <div className="voice-setup">
      <div className="voice-option">
        <div className="voice-option-head">
          <Mic size={16} />
          <div>
            <strong>{t('On this computer')}</strong>
            <small>{localSupported ? t('Private and free. Downloads a Whisper model once.') : t('Local voice is available on Windows for now.')}</small>
          </div>
        </div>
        {localSupported &&
          stt.map((m) => {
            const active = mode?.type === 'local' && mode.modelId === m.id
            const pct = m.downloading?.total ? Math.round((m.downloading.received / m.downloading.total) * 100) : 0
            return (
              <div key={m.id} className={`voice-model ${active ? 'active' : ''} fit-${m.fit.level}`}>
                <div className="min-w-0 flex-1">
                  <strong>{m.name}</strong> {m.id === rec && <span className="hub-badge hub-badge-rec">{t('Recommended')}</span>}
                  <small className="num">
                    {Math.round(m.size / 1e6)} MB · {t(m.fit.reason, m.fit.vars)}
                  </small>
                  {m.downloading && (
                    <div className="local-bar mt-1">
                      <i style={{ width: `${Math.max(3, pct)}%` }} />
                    </div>
                  )}
                </div>
                {m.installed ? (
                  <>
                    <button className={`orbi-btn ${active ? 'orbi-btn-primary' : ''}`} onClick={() => pick({ type: 'local', modelId: m.id })}>
                      {active ? <Check size={13} /> : null} {active ? t('In use') : t('Use')}
                    </button>
                    <button
                      className="icon-button"
                      title={t('Uninstall')}
                      onClick={async () => {
                        if (!confirm(t('Remove {name} from this computer? You can download it again anytime.', { name: m.name }))) return
                        await api.removeLocal(m.id)
                        if (active) {
                          setMode(null)
                          api.setSetting('voiceMode', null)
                        }
                        onLocalChanged()
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : m.downloading ? (
                  <button className="orbi-btn" onClick={() => api.cancelLocal(m.id).then(onLocalChanged)}>
                    <Loader2 size={13} className="animate-spin" /> {pct}% · {t('Cancel')}
                  </button>
                ) : (
                  <button
                    className={`orbi-btn ${m.id === rec ? 'orbi-btn-primary' : ''}`}
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy(m.id)
                      setError(null)
                      try {
                        await api.installLocalModel(m.id)
                        onLocalChanged()
                        pick({ type: 'local', modelId: m.id })
                      } catch (e) {
                        setError(cleanErr(e))
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    {busy === m.id ? <Loader2 size={13} className="animate-spin" /> : null} {t('Download & use')}
                  </button>
                )}
              </div>
            )
          })}
      </div>
      <div className="voice-option">
        <div className="voice-option-head">
          <Globe size={16} />
          <div>
            <strong>{t('Through an API')}</strong>
            <small>{t('Best accuracy, nothing to download. Uses your provider key.')}</small>
          </div>
        </div>
        {(['openai', 'groq'] as const).map((id) => {
          const active = mode?.type === 'api' && mode.provider === id
          return (
            <div key={id} className={`voice-model ${active ? 'active' : ''}`}>
              <div className="min-w-0 flex-1">
                <strong>{id === 'openai' ? 'OpenAI Whisper' : 'Groq Whisper Large v3 Turbo'}</strong>
                <small>{keyed(id) ? t('Key connected') : t('Needs a {p} key in AI providers', { p: id === 'openai' ? 'OpenAI' : 'Groq' })}</small>
              </div>
              <button className={`orbi-btn ${active ? 'orbi-btn-primary' : ''}`} disabled={!keyed(id)} onClick={() => pick({ type: 'api', provider: id })}>
                {active ? t('In use') : t('Use')}
              </button>
            </div>
          )
        })}
      </div>
      {mode && <MicTest mode={mode} />}
      {error && <p className="provider-status provider-status-error">{error}</p>}
    </div>
  )
}

// Record a few seconds and show what the chosen voice-input model understood.
export function MicTest({ mode }: { mode: VoiceMode }) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [stopFn, setStopFn] = useState<null | (() => Promise<string>)>(null)
  const [result, setResult] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toggle = async () => {
    setErr(null)
    if (state === 'recording' && stopFn) {
      setState('working')
      try {
        const wav = await stopFn()
        const text = await api.transcribe({ wav, mode, language: getLang().slice(0, 2) })
        setResult(text || t('(nothing was heard)'))
      } catch (e) {
        setErr(cleanErr(e))
      } finally {
        setState('idle')
        setStopFn(null)
      }
      return
    }
    try {
      const fn = await recordWav()
      setStopFn(() => fn)
      setResult(null)
      setState('recording')
    } catch (e) {
      setErr(cleanErr(e))
    }
  }
  return (
    <div className="voice-test">
      <button className={`orbi-btn ${state === 'recording' ? 'orbi-btn-primary' : ''}`} onClick={toggle} disabled={state === 'working'}>
        {state === 'working' ? <Loader2 size={13} className="animate-spin" /> : state === 'recording' ? <Square size={11} /> : <Mic size={13} />}
        {state === 'recording' ? t('Stop and transcribe') : t('Test the microphone')}
      </button>
      {result && <p className="voice-test-result">“{result}”</p>}
      {err && <p className="provider-status provider-status-error">{err}</p>}
    </div>
  )
}

