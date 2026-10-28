import { useEffect, useState } from 'react'
import { Boxes, Check, Download, ExternalLink, FolderOpen, Globe, Info, KeyRound, Loader2, Mic, Plug, Server, SlidersHorizontal, Square, UserRound, Volume2, X } from 'lucide-react'
import { api, type AppInfo, type LocalStatus, type ProviderInfo, type TtsChoice, type VoiceMode } from '../lib/api'
import { sampleFor, speak, stopSpeaking, systemVoices } from '../lib/tts'
import { recordWav } from '../lib/voice'
import { LANGUAGES, getLang, t, type Lang } from '../lib/i18n'
import { OrbiMark } from './Logo'
import { UpdateSection } from './UpdateCenter'
import { ModelHub } from './ModelHub'
import { VoiceLibrary } from './VoiceLibrary'
import { VoiceSettings } from './VoiceInput'

const KEY_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  ollama: 'https://ollama.com/download',
  lmstudio: 'https://lmstudio.ai',
}

export type SettingsTab = 'general' | 'providers' | 'models' | 'voice' | 'about' | 'profile'

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string }
const cleanErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ProviderCard({ provider, onChanged }: { provider: ProviderInfo; onChanged: () => void }) {
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(provider.customBaseUrl)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const showBaseUrl = provider.mode === 'Local'

  const runTest = async () => {
    setTest({ status: 'testing' })
    try {
      if (key) await api.saveProvider(provider.id, { apiKey: key, enabled: true })
      if (showBaseUrl) await api.saveProvider(provider.id, { baseUrl, enabled: true })
      const r = await api.testProvider(provider.id)
      await api.saveProvider(provider.id, { enabled: true })
      setKey('')
      setTest({ status: 'ok', message: t('Connected · {n} models', { n: r.count }) })
      onChanged()
    } catch (e) {
      setTest({ status: 'error', message: cleanErr(e) })
    }
  }

  return (
    <div className={`provider-card ${provider.enabled ? 'provider-card-on' : ''}`}>
      <div className="provider-card-head">
        <div className="provider-icon">{provider.mode === 'Local' ? <Server size={16} /> : <Plug size={16} />}</div>
        <div className="min-w-0 flex-1">
          <p className="provider-name">
            {provider.name}
            <span className={`provider-badge ${provider.mode === 'Local' ? 'provider-badge-local' : ''}`}>{provider.mode === 'Local' ? t('Local') : 'API'}</span>
          </p>
          <p className="provider-hint">{t(provider.hint)}</p>
        </div>
        <button
          className={`orbi-switch ${provider.enabled ? 'orbi-switch-on' : ''}`}
          onClick={async () => {
            await api.saveProvider(provider.id, { enabled: !provider.enabled })
            onChanged()
          }}
          aria-label={provider.enabled ? t('Disable provider') : t('Enable provider')}
          aria-pressed={provider.enabled}
        >
          <span />
        </button>
      </div>
      <div className="provider-fields">
        {provider.needsKey && (
          <label className="orbi-field">
            <KeyRound size={14} />
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider.hasKey ? t('API key saved — paste to replace') : t('Paste your API key')} spellCheck={false} />
          </label>
        )}
        {showBaseUrl && (
          <label className="orbi-field">
            <Server size={14} />
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.baseUrl} spellCheck={false} />
          </label>
        )}
        <div className="provider-actions">
          <button className="orbi-btn orbi-btn-primary" onClick={runTest} disabled={test.status === 'testing' || (provider.needsKey && !key && !provider.hasKey)}>
            {test.status === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {provider.needsKey ? t('Save & connect') : t('Connect')}
          </button>
          {KEY_URLS[provider.id] && (
            <button className="orbi-btn" onClick={() => api.openExternal(KEY_URLS[provider.id])}>
              <ExternalLink size={13} />
              {provider.needsKey ? t('Get a key') : t('Download')}
            </button>
          )}
          {test.status !== 'idle' && test.status !== 'testing' && <span className={`provider-status ${test.status === 'error' ? 'provider-status-error' : ''}`}>{test.message}</span>}
        </div>
      </div>
    </div>
  )
}

export { VoiceSettings } from './VoiceInput'

// Read-aloud voice: the shared voice library (natural offline voices and the system voices).
export function VoiceOutputSettings({ status, onLocalChanged }: { status: LocalStatus | null; onLocalChanged: () => void }) {
  return <VoiceLibrary status={status} onLocalChanged={onLocalChanged} />
}

export function SettingsModal({
  onClose,
  onChanged,
  initialTab = 'general',
  userName,
  setUserName,
  info,
  localStatus,
  onLocalChanged,
  lang,
  setLang,
  onOpenSetup,
}: {
  onClose: () => void
  onChanged: () => void
  initialTab?: SettingsTab
  userName: string
  setUserName: (n: string) => void
  info: AppInfo | null
  localStatus: LocalStatus | null
  onLocalChanged: () => void
  lang: Lang
  setLang: (l: Lang) => void
  onOpenSetup?: () => void
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab === 'profile' ? 'general' : initialTab)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [name, setName] = useState(userName)

  const load = () => api.providers().then(setProviders)
  useEffect(() => {
    load()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const nav: { id: SettingsTab; label: string; icon: typeof Plug }[] = [
    { id: 'general', label: 'General', icon: SlidersHorizontal },
    { id: 'providers', label: 'AI providers', icon: Plug },
    { id: 'models', label: 'Local models', icon: Boxes },
    { id: 'voice', label: 'Voice', icon: Mic },
    { id: 'about', label: 'About', icon: Info },
  ]

  return (
    <div className="orbi-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="orbi-modal" role="dialog" aria-label={t('Settings')}>
        <aside className="orbi-modal-nav">
          <p className="orbi-modal-title">{t('Settings')}</p>
          {nav.map((n) => {
            const Icon = n.icon
            return (
              <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)}>
                <Icon size={15} /> {t(n.label)}
              </button>
            )
          })}
        </aside>
        <section className="orbi-modal-body">
          <button className="orbi-modal-close" onClick={onClose} aria-label={t('Close settings')}>
            <X size={17} />
          </button>

          {tab === 'general' && (
            <>
              <h3>{t('General')}</h3>
              <label className="orbi-label">{t('Language')}</label>
              <div className="lang-grid">
                {LANGUAGES.map((l) => (
                  <button key={l.id} className={`lang-option ${lang === l.id ? 'active' : ''}`} onClick={() => setLang(l.id)}>
                    {lang === l.id && <Check size={13} />}
                    {l.name}
                  </button>
                ))}
              </div>
              <label className="orbi-label">{t('Your name')}</label>
              <div className="flex gap-2">
                <label className="orbi-field flex-1">
                  <UserRound size={14} />
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <button
                  className="orbi-btn orbi-btn-primary"
                  onClick={() => {
                    setUserName(name.trim() || userName)
                    api.setSetting('userName', name.trim() || userName)
                  }}
                >
                  {t('Save')}
                </button>
              </div>
              <p className="orbi-muted mt-3">{t('Used in greetings. Plans, billing and cloud sync arrive with the OrbiX account.')}</p>
            </>
          )}

          {tab === 'providers' && (
            <>
              <h3>{t('AI providers')}</h3>
              <p className="orbi-muted">{t("Connect at least one provider to start chatting. Keys are encrypted with your system's secure storage and never leave this computer except to call that provider.")}</p>
              <div className="provider-list">
                {providers
                  .filter((p) => p.id !== 'orbi')
                  .map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      onChanged={() => {
                        load()
                        onChanged()
                      }}
                    />
                  ))}
              </div>
            </>
          )}

          {tab === 'models' && (
            <>
              <h3>{t('Local models')}</h3>
              <p className="orbi-muted">{t('Free models that run on this computer. Orbi checks your hardware and recommends what fits — you can still install anything.')}</p>
              <ModelHub
                onOpenSetup={onOpenSetup}
                status={localStatus}
                onChanged={() => {
                  onLocalChanged()
                  onChanged()
                }}
              />
            </>
          )}

          {tab === 'voice' && (
            <>
              <h3>{t('Voice')}</h3>
              <p className="orbi-label">{t('Voice input (microphone)')}</p>
              <p className="orbi-muted">{t('Whisper models turn your speech into text — they don’t have a voice. Test them with the button below.')}</p>
              <VoiceSettings status={localStatus} onLocalChanged={onLocalChanged} />
              <p className="orbi-label mt-6">{t('Read-aloud voice')}</p>
              <p className="orbi-muted">{t('Listen to each voice and pick the default for the speaker button and for voiceovers.')}</p>
              <VoiceOutputSettings status={localStatus} onLocalChanged={onLocalChanged} />
            </>
          )}

          {tab === 'about' && (
            <div className="about-page">
              <div className="about-mark">
                <OrbiMark width={30} height={30} />
              </div>
              <h3>{t('Orbi')}</h3>
              <p className="about-version num">
                {t('Version')} {info?.version}
              </p>
              <p className="about-credit">
                <strong>{info?.company ?? 'Draft Creative Studio Ltda'}</strong>
                <span>{info?.tagline ?? 'Creative Design & Software Development'}</span>
              </p>
              <p className="orbi-muted">{t('Chats, projects, memories and generated media are stored locally in a SQLite database and a media folder.')}</p>
              <div className="about-grid">
                <span>{t('Data folder')}</span>
                <strong className="truncate" title={info?.dataDir}>
                  {info?.dataDir}
                </strong>
                <span>{t('License')}</span>
                <strong>Apache-2.0</strong>
              </div>
              <UpdateSection />
              <div className="mt-4 flex gap-2">
                <button className="orbi-btn" onClick={() => api.revealData()}>
                  <FolderOpen size={14} /> {t('Open data folder')}
                </button>
                <button className="orbi-btn" onClick={() => api.openExternal('https://github.com/iwerry/chatorbit-app')}>
                  <ExternalLink size={13} /> GitHub
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
