import { useEffect, useState } from 'react'
import { Check, Cpu, Download, ExternalLink, FolderOpen, KeyRound, Link2, Loader2, Plug, Server, Square, Trash2, UserRound, X } from 'lucide-react'
import { api, type AppInfo, type LocalStatus, type ProviderInfo } from '../lib/api'

const KEY_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  mistral: 'https://console.mistral.ai/api-keys',
  ollama: 'https://ollama.com/download',
  lmstudio: 'https://lmstudio.ai',
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string }

function ProviderCard({ provider, onChanged }: { provider: ProviderInfo; onChanged: () => void }) {
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(provider.customBaseUrl)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const showBaseUrl = provider.mode === 'Local'

  const save = async (patch: Parameters<typeof api.saveProvider>[1]) => {
    await api.saveProvider(provider.id, patch)
    onChanged()
  }

  const runTest = async () => {
    setTest({ status: 'testing' })
    try {
      if (key) await api.saveProvider(provider.id, { apiKey: key, enabled: true })
      if (showBaseUrl) await api.saveProvider(provider.id, { baseUrl, enabled: true })
      const r = await api.testProvider(provider.id)
      await api.saveProvider(provider.id, { enabled: true })
      setKey('')
      setTest({ status: 'ok', message: `Connected · ${r.count} models` })
      onChanged()
    } catch (e) {
      setTest({ status: 'error', message: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  return (
    <div className={`provider-card ${provider.enabled ? 'provider-card-on' : ''}`}>
      <div className="provider-card-head">
        <div className="provider-icon">{provider.mode === 'Local' ? <Server size={16} /> : <Plug size={16} />}</div>
        <div className="min-w-0 flex-1">
          <p className="provider-name">
            {provider.name}
            <span className={`provider-badge ${provider.mode === 'Local' ? 'provider-badge-local' : ''}`}>{provider.mode}</span>
          </p>
          <p className="provider-hint">{provider.hint}</p>
        </div>
        <button
          className={`orbi-switch ${provider.enabled ? 'orbi-switch-on' : ''}`}
          onClick={() => save({ enabled: !provider.enabled })}
          aria-label={provider.enabled ? 'Disable provider' : 'Enable provider'}
          aria-pressed={provider.enabled}
        >
          <span />
        </button>
      </div>

      <div className="provider-fields">
        {provider.needsKey && (
          <label className="orbi-field">
            <KeyRound size={14} />
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={provider.hasKey ? 'API key saved — paste to replace' : 'Paste your API key'}
              spellCheck={false}
            />
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
            {provider.needsKey ? 'Save & connect' : 'Connect'}
          </button>
          {KEY_URLS[provider.id] && (
            <button className="orbi-btn" onClick={() => api.openExternal(KEY_URLS[provider.id])}>
              <ExternalLink size={13} />
              {provider.needsKey ? 'Get a key' : 'Download'}
            </button>
          )}
          {test.status !== 'idle' && test.status !== 'testing' && (
            <span className={`provider-status ${test.status === 'error' ? 'provider-status-error' : ''}`}>{test.message}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function mb(n: number) {
  return n ? `${Math.round(n / 1_000_000)} MB` : ''
}

export function LocalAICard({ status, onChanged }: { status: LocalStatus | null; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  if (!status) return null
  const install = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const engine = status.engineDownloading
  return (
    <div className="provider-card provider-card-on local-card">
      <div className="provider-card-head">
        <div className="provider-icon">
          <Cpu size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="provider-name">
            Orbi Local <span className="provider-badge provider-badge-local">Free · Offline</span>
          </p>
          <p className="provider-hint">
            Tiny open models that run on this PC with llama.cpp. Nothing is bundled — download only what you want.
            {status.running && ` Running: ${status.running.modelId}.`}
          </p>
        </div>
        {status.running && (
          <button className="orbi-btn" onClick={() => api.stopLocal().then(onChanged)} title="Stop local engine">
            <Square size={12} /> Stop
          </button>
        )}
      </div>
      {engine && (
        <div className="local-progress">
          <span>Downloading engine (llama.cpp {status.engineTag})…</span>
          <div className="local-bar">
            <i style={{ width: `${engine.total ? (engine.received / engine.total) * 100 : 5}%` }} />
          </div>
        </div>
      )}
      <div className="local-models">
        {status.models.map((m) => (
          <div className={`local-model ${m.installed ? 'installed' : ''}`} key={m.id}>
            <div className="min-w-0 flex-1">
              <p>
                <strong>{m.name}</strong>
                {m.badge && <span className="provider-badge">{m.badge}</span>}
              </p>
              <small>
                {[mb(m.size), m.ram, m.license].filter(Boolean).join(' · ')}
                {m.description && !m.description.startsWith('http') ? ` — ${m.description}` : ''}
              </small>
              {m.downloading && (
                <div className="local-bar mt-2">
                  <i style={{ width: `${m.downloading.total ? (m.downloading.received / m.downloading.total) * 100 : 3}%` }} />
                </div>
              )}
            </div>
            {m.installed ? (
              <div className="flex items-center gap-1.5">
                <span className="provider-status">
                  <Check size={12} className="inline" /> Ready
                </span>
                <button className="orbi-btn" title="Delete model" onClick={() => install(() => api.removeLocal(m.id))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ) : m.downloading ? (
              <button className="orbi-btn" onClick={() => api.cancelLocal(m.id)}>
                {Math.round((m.downloading.received / (m.downloading.total || 1)) * 100)}% · Cancel
              </button>
            ) : (
              <button className="orbi-btn orbi-btn-primary" onClick={() => install(() => api.installLocalModel(m.id))}>
                <Download size={13} /> Download
              </button>
            )}
          </div>
        ))}
      </div>
      {showCustom ? (
        <div className="provider-fields mt-2" style={{ paddingLeft: 0 }}>
          <label className="orbi-field">
            <Link2 size={14} />
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="https://huggingface.co/…/resolve/main/model.gguf" spellCheck={false} />
          </label>
          <div className="provider-actions">
            <button className="orbi-btn orbi-btn-primary" disabled={!custom.trim()} onClick={() => install(() => api.addCustomLocal(custom.trim()))}>
              <Download size={13} /> Download GGUF
            </button>
            <button className="orbi-btn" onClick={() => setShowCustom(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="local-custom-link" onClick={() => setShowCustom(true)}>
          + Add any GGUF from Hugging Face
        </button>
      )}
      {error && <p className="provider-status provider-status-error mt-2">{error}</p>}
    </div>
  )
}

export function SettingsModal({
  onClose,
  onChanged,
  initialTab = 'providers',
  userName,
  setUserName,
  info,
  localStatus,
  onLocalChanged,
}: {
  onClose: () => void
  onChanged: () => void
  initialTab?: 'providers' | 'profile' | 'about'
  userName: string
  setUserName: (n: string) => void
  info: AppInfo | null
  localStatus: LocalStatus | null
  onLocalChanged: () => void
}) {
  const [tab, setTab] = useState(initialTab)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [name, setName] = useState(userName)

  const load = () => api.providers().then(setProviders)
  useEffect(() => {
    load()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="orbi-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="orbi-modal" role="dialog" aria-label="Settings">
        <aside className="orbi-modal-nav">
          <p className="orbi-modal-title">Settings</p>
          <button className={tab === 'providers' ? 'active' : ''} onClick={() => setTab('providers')}>
            <Plug size={15} /> AI providers
          </button>
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
            <UserRound size={15} /> Profile
          </button>
          <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>
            <FolderOpen size={15} /> Data & about
          </button>
        </aside>
        <section className="orbi-modal-body">
          <button className="orbi-modal-close" onClick={onClose} aria-label="Close settings">
            <X size={17} />
          </button>
          {tab === 'providers' && (
            <>
              <h3>AI providers</h3>
              <p className="orbi-muted">
                Connect at least one provider to start chatting. Keys are encrypted with your system's secure storage and never leave this computer except to call that provider.
              </p>
              <div className="provider-list">
                <LocalAICard
                  status={localStatus}
                  onChanged={() => {
                    onLocalChanged()
                    onChanged()
                  }}
                />
                {providers.filter((p) => p.id !== 'orbi').map((p) => (
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
          {tab === 'profile' && (
            <>
              <h3>Profile</h3>
              <label className="orbi-label">Your name</label>
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
                  Save
                </button>
              </div>
              <p className="orbi-muted mt-3">Used in greetings. Plans, billing and cloud sync arrive with the OrbiX account.</p>
            </>
          )}
          {tab === 'about' && (
            <>
              <h3>Data & about</h3>
              <p className="orbi-muted">
                Chats, projects, memories and generated media are stored locally in a SQLite database and a media folder.
              </p>
              <div className="about-grid">
                <span>Version</span>
                <strong>{info?.version}</strong>
                <span>Data folder</span>
                <strong className="truncate" title={info?.dataDir}>
                  {info?.dataDir}
                </strong>
              </div>
              <button className="orbi-btn mt-4" onClick={() => api.revealData()}>
                <FolderOpen size={14} /> Open data folder
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
