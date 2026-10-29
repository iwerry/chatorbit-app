// Orbi account: sign in / create account, plan and credits, buying, usage, and the cloud voice settings.
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, CircleAlert, CreditCard, ExternalLink, Loader2, LogOut, Mic, RefreshCw, Server, Sparkles, Volume2, Wallet } from 'lucide-react'
import { api, type CloudPlans, type CloudUsageItem } from '../lib/api'
import { fmtCredits, refreshCloud, useCloud } from '../lib/cloud'
import { fmtDate, t } from '../lib/i18n'
import { OrbiMark } from './Logo'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ServerField({ compact }: { compact?: boolean }) {
  const { state } = useCloud()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(state?.url || '')
  useEffect(() => setUrl(state?.url || ''), [state?.url])
  const online = state?.online !== false && state?.code !== 'offline'
  return (
    <div className={`acct-server ${compact ? 'compact' : ''}`}>
      <button type="button" className="acct-server-line" onClick={() => setOpen((v) => !v)}>
        <span className={`mcp-dot ${online ? 'mcp-dot-connected' : 'mcp-dot-error'}`} />
        <Server size={12} />
        <span className="truncate">{online ? t('Orbi Cloud · {url}', { url: state?.url || '' }) : t('Orbi Cloud is offline · {url}', { url: state?.url || '' })}</span>
      </button>
      {open && (
        <form
          className="acct-server-form"
          onSubmit={async (e) => {
            e.preventDefault()
            await api.cloudSetUrl(url)
            await refreshCloud()
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" aria-label={t('Server address')} />
          <button className="orbi-btn" type="submit">
            {t('Connect')}
          </button>
        </form>
      )}
    </div>
  )
}

/** Full-screen sign-in shown until the user has an Orbi account on this PC. */
export function AccountGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { state } = useCloud()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') await api.cloudSignup({ email, password, name })
      else await api.cloudLogin({ email, password })
      await refreshCloud()
      onSignedIn()
    } catch (err) {
      setError(t(clean(err)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="acct-gate">
      <form className="acct-card" onSubmit={submit}>
        <div className="acct-mark">
          <OrbiMark width={30} height={30} />
        </div>
        <h2>{mode === 'signup' ? t('Create your Orbi account') : t('Welcome back')}</h2>
        <p className="acct-lead">{t('The best AI models for chat, images, video and voice — in one app, with one account.')}</p>
        <div className="acct-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
            {t('Create account')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            {t('Sign in')}
          </button>
        </div>
        {mode === 'signup' && (
          <label className="acct-field">
            <span>{t('Name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="acct-field">
          <span>{t('Email')}</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
        </label>
        <label className="acct-field">
          <span>{t('Password')}</span>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {mode === 'signup' && <small>{t('At least 8 characters.')}</small>}
        </label>
        {error && (
          <p className="acct-error" role="alert">
            <CircleAlert size={14} /> {error}
          </p>
        )}
        <button className="orbi-btn orbi-btn-primary acct-submit" type="submit" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
          {mode === 'signup' ? t('Create account') : t('Sign in')}
        </button>
        {mode === 'signup' && <p className="acct-fine">{t('New accounts get free credits to try Orbi.')}</p>}
        <ServerField compact />
        {state?.code === 'offline' && <p className="acct-fine">{t('Start Orbi Cloud on this PC (cloud folder → npm start) or enter its address above.')}</p>}
      </form>
    </div>
  )
}

/** Settings → Account. */
export function AccountPanel() {
  const { state, refresh } = useCloud()
  const [plans, setPlans] = useState<CloudPlans | null>(null)
  const [usage, setUsage] = useState<CloudUsageItem[]>([])
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const user = state?.user
  const load = () => {
    api.cloudPlans().then(setPlans).catch(() => {})
    api.cloudUsage().then((r) => setUsage(r.items)).catch(() => {})
  }
  useEffect(() => {
    load()
    // Coming back from the Stripe page: pick up the new plan and credits.
    const onFocus = () => (refresh(), load())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    setNote('')
    try {
      await fn()
      if (done) setNote(done)
    } catch (e) {
      setNote(t(clean(e)))
    } finally {
      setBusy('')
    }
  }
  if (!user) return <p className="orbi-muted">{state?.error ? t(state.error) : t('Loading…')}</p>
  const planTotal = user.plan?.monthlyCredits || 0
  const pct = planTotal ? Math.max(0, Math.min(100, (user.credits.plan / planTotal) * 100)) : 0
  return (
    <div className="acct-panel">
      <div className="acct-head">
        <div className="acct-avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <strong className="truncate">{user.name || user.email}</strong>
          <small className="truncate">{user.email}</small>
        </div>
        <button className="orbi-btn" onClick={() => act('refresh', async () => (await refresh(), load()))} title={t('Refresh')}>
          {busy === 'refresh' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
        <button className="orbi-btn" onClick={() => act('logout', async () => (await api.cloudLogout(), await refresh()))}>
          <LogOut size={13} /> {t('Sign out')}
        </button>
      </div>

      <div className="acct-balance">
        <div>
          <p className="acct-label">{t('Credits')}</p>
          <p className="acct-big num">{fmtCredits(user.credits.total)}</p>
          <small className="num">
            {user.plan ? t('{a} from your plan · {b} extra', { a: fmtCredits(user.credits.plan), b: fmtCredits(user.credits.extra) }) : t('{b} available', { b: fmtCredits(user.credits.total) })}
          </small>
        </div>
        <div className="acct-plan">
          <p className="acct-label">{t('Plan')}</p>
          <p className="acct-plan-name">{user.plan ? user.plan.name : t('No plan yet')}</p>
          {user.plan?.renews ? <small>{t('Renews on {date}', { date: fmtDate(user.plan.renews) })}</small> : <small>{t('Choose a plan to get monthly credits.')}</small>}
          {user.plan && (
            <div className="acct-meter" aria-label={t('Plan credits left')}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>

      {!plans?.payments && <p className="acct-warn">{t('Payments are not set up on this Orbi Cloud server yet. Credits can be added by the administrator.')}</p>}

      {!user.plan && plans && (
        <>
          <p className="orbi-label">{t('Choose a plan')}</p>
          <div className="acct-plans">
            {plans.plans.map((p) => (
              <div key={p.id} className="acct-plan-card">
                <strong>{p.name}</strong>
                <p className="acct-price">{p.priceLabel}</p>
                <p className="num">{t('{n} credits every month', { n: fmtCredits(p.monthlyCredits) })}</p>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>
                      <Check size={12} /> {t(f)}
                    </li>
                  ))}
                </ul>
                <button className="orbi-btn orbi-btn-primary" disabled={!p.available || !!busy} onClick={() => act(p.id, () => api.cloudCheckout(p.id), t('Finish the payment in your browser, then come back here.'))}>
                  {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />} {t('Subscribe')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {user.plan && plans && (
        <>
          <p className="orbi-label">{t('Extra credits')}</p>
          <p className="orbi-muted">{t('Extra credits never expire and are used after your monthly credits.')}</p>
          <div className="acct-packs">
            {plans.packs.map((p) => (
              <button key={p.id} className="acct-pack" disabled={!p.available || !!busy} onClick={() => act(p.id, () => api.cloudCheckout(p.id), t('Finish the payment in your browser, then come back here.'))}>
                {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
                <span>
                  <strong>{t(p.name)}</strong>
                  <small>{p.priceLabel}</small>
                </span>
              </button>
            ))}
          </div>
          <button className="orbi-btn mt-3" onClick={() => act('portal', () => api.cloudPortal(), t('The subscription page opened in your browser.'))}>
            <ExternalLink size={13} /> {t('Manage subscription')}
          </button>
        </>
      )}

      {note && <p className="acct-note">{note}</p>}

      <p className="orbi-label mt-6">{t('Recent use')}</p>
      {usage.length === 0 ? (
        <p className="orbi-muted">{t('Nothing yet.')}</p>
      ) : (
        <ul className="acct-usage">
          {usage.slice(0, 30).map((u, i) => (
            <li key={i}>
              <span className="truncate">
                {t(u.note || u.kind)}
                {u.model && <small> · {u.model}</small>}
              </span>
              <em className={`num ${u.amount < 0 ? 'neg' : 'pos'}`}>
                {u.amount > 0 ? '+' : ''}
                {fmtCredits(u.amount)}
              </em>
              <small className="num">{fmtDate(u.created_at)}</small>
            </li>
          ))}
        </ul>
      )}
      <ServerField />
    </div>
  )
}

/** Settings → Voice, when Orbi runs on Orbi Cloud. */
export function CloudVoiceSettings() {
  const { catalog } = useCloud()
  const [voice, setVoice] = useState<{ model?: string; voice?: string }>({})
  const [stt, setStt] = useState('')
  const [testing, setTesting] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.getSetting<{ model?: string; voice?: string }>('cloudVoice', {}).then((v) => setVoice(v || {}))
    api.getSetting<string>('cloudStt', '').then((v) => setStt(v || ''))
  }, [])
  const tts = catalog?.tts ?? []
  const model = tts.find((m) => m.id === voice.model) ?? tts[0]
  const save = (v: { model?: string; voice?: string }) => {
    setVoice(v)
    api.setSetting('cloudVoice', v)
    api.setSetting('ttsVoice', { type: 'cloud', model: v.model || '', voice: v.voice || '' })
  }
  return (
    <div className="acct-voice">
      <p className="orbi-label">
        <Mic size={13} /> {t('Dictation (microphone)')}
      </p>
      <select className="ab-input" value={stt || catalog?.stt[0]?.id || ''} onChange={(e) => (setStt(e.target.value), api.setSetting('cloudStt', e.target.value))}>
        {(catalog?.stt ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <p className="orbi-muted">{t('Pick the microphone with the arrow next to the mic button in the chat.')}</p>
      <p className="orbi-label mt-6">
        <Volume2 size={13} /> {t('Read-aloud voice')}
      </p>
      <div className="flex gap-2">
        <select className="ab-input flex-1" value={model?.id || ''} onChange={(e) => save({ model: e.target.value, voice: tts.find((m) => m.id === e.target.value)?.voices[0] })}>
          {tts.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {!!model?.voices.length && (
          <select className="ab-input" value={voice.voice || model.voices[0]} onChange={(e) => save({ model: model.id, voice: e.target.value })}>
            {model.voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        <button
          className="orbi-btn"
          disabled={testing}
          onClick={async () => {
            setTesting(true)
            setErr('')
            try {
              const { speak } = await import('../lib/tts')
              await speak(t('Hi! This is how I will read your answers.'), { type: 'cloud', model: model?.id || '', voice: voice.voice || model?.voices[0] || '' }, 'en')
            } catch (e) {
              setErr(t(clean(e)))
            } finally {
              setTesting(false)
            }
          }}
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t('Listen')}
        </button>
      </div>
      {err && <p className="acct-error">{err}</p>}
    </div>
  )
}
