import { AccountPanel, CloudVoiceSettings } from './AccountPanel'
import { useCloud } from '../lib/cloud'
import { useEffect, useState } from 'react'
import { Check, ExternalLink, FolderOpen, Info, KeyRound, Loader2, Mic, SlidersHorizontal, UserRound, Wallet, X } from 'lucide-react'
import { api, type AppInfo } from '../lib/api'
import { LANGUAGES, t, type Lang } from '../lib/i18n'
import { OrbiMark } from './Logo'
import { UpdateSection } from './UpdateCenter'

export type SettingsTab = 'account' | 'general' | 'voice' | 'about' | 'profile'

const cleanErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Signed-in password change: the current session proves who it is, so no e-mail code is needed.
function ChangePassword() {
  const { state } = useCloud()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!state?.signedIn) return null
  const save = async () => {
    if (password.length < 8) return setMsg(t('At least 8 characters.'))
    if (password !== repeat) return setMsg(t('The passwords do not match.'))
    setBusy(true)
    try {
      await api.cloudChangePassword({ password })
      setPassword('')
      setRepeat('')
      setMsg(t('Password changed. Use it the next time you sign in.'))
    } catch (e) {
      setMsg(t(cleanErr(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label className="orbi-label mt-6">{t('Password')}</label>
      <div className="flex gap-2">
        <label className="orbi-field flex-1">
          <KeyRound size={14} />
          <input type="password" minLength={8} required placeholder={t('New password')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="orbi-field flex-1">
          <KeyRound size={14} />
          <input type="password" minLength={8} required placeholder={t('Repeat the new password')} value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        </label>
        <button className="orbi-btn orbi-btn-primary" type="submit" disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : t('Change password')}
        </button>
      </div>
      <p className="orbi-muted mt-3">{msg || t('At least 8 characters.')}</p>
    </form>
  )
}

export function SettingsModal({
  onClose,
  onChanged,
  initialTab = 'general',
  userName,
  setUserName,
  info,
  lang,
  setLang,
}: {
  onClose: () => void
  onChanged: () => void
  initialTab?: SettingsTab
  userName: string
  setUserName: (n: string) => void
  info: AppInfo | null
  lang: Lang
  setLang: (l: Lang) => void
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab === 'profile' ? 'general' : initialTab)
  const [name, setName] = useState(userName)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const nav: { id: SettingsTab; label: string; icon: typeof Info }[] = [
    { id: 'account', label: 'Account & credits', icon: Wallet },
    { id: 'general', label: 'General', icon: SlidersHorizontal },
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

          {tab === 'account' && (
            <>
              <h3>{t('Account & credits')}</h3>
              <AccountPanel />
            </>
          )}

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
              <p className="orbi-muted mt-3">{t('Used in greetings.')}</p>
              <ChangePassword />
            </>
          )}

          {tab === 'voice' && (
            <>
              <h3>{t('Voice')}</h3>
              <CloudVoiceSettings />
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
