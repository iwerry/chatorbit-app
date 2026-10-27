// In-app updates: a small card when a new release is out, download on demand,
// and a confirmation that lists what will be stopped before installing.
import { useEffect, useState } from 'react'
import { ArrowDownToLine, Check, Loader2, PartyPopper, RefreshCw, Rocket, X } from 'lucide-react'
import { api, on, type ActiveWork, type UpdateInfo } from '../lib/api'
import { fmtBytes, fmtDate, t } from '../lib/i18n'
import { Markdown } from './Markdown'

export function useUpdates() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    api.updateState().then(setInfo).catch(() => {})
    return on('update:state', (s: UpdateInfo) => setInfo(s))
  }, [])
  return info
}

export function UpdateCenter() {
  const info = useUpdates()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [notes, setNotes] = useState(false)
  const [confirm, setConfirm] = useState<ActiveWork[] | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    api.getSetting<string | null>('updateDismissed', null).then(setDismissed)
    return on('update:done', (v: string) => setDone(v))
  }, [])
  useEffect(() => {
    if (!done) return
    const tm = setTimeout(() => setDone(null), 8000)
    return () => clearTimeout(tm)
  }, [done])

  const latest = info?.latest
  const show = info && latest && ['available', 'available-manual', 'downloading', 'ready', 'installing', 'error'].includes(info.status) && !(info.status === 'available' && dismissed === latest.version)
  const pct = info?.progress?.total ? Math.round((info.progress.received / info.progress.total) * 100) : 0

  const askInstall = async () => setConfirm(await api.activeWork().catch(() => []))

  return (
    <>
      {done && (
        <div className="update-card update-done" role="status">
          <PartyPopper size={16} />
          <span>{t('Orbi was updated to {v}.', { v: done })}</span>
          <button onClick={() => setDone(null)} aria-label={t('Close')}>
            <X size={13} />
          </button>
        </div>
      )}
      {show && latest && (
        <div className="update-card" role="status">
          <div className="update-card-head">
            <Rocket size={16} />
            <div className="min-w-0 flex-1">
              <strong>{info.status === 'ready' ? t('Update ready to install') : t('New version available')}</strong>
              <small className="num">
                {info.current} → {latest.version}
                {latest.publishedAt ? ` · ${fmtDate(new Date(latest.publishedAt).getTime())}` : ''}
              </small>
            </div>
            {info.status === 'available' && (
              <button
                className="update-x"
                title={t('Remind me next version')}
                onClick={() => {
                  setDismissed(latest.version)
                  api.setSetting('updateDismissed', latest.version)
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          {info.status === 'downloading' && (
            <div className="local-progress">
              <span className="num">
                {pct}% · {fmtBytes(info.progress?.received || 0)} / {fmtBytes(info.progress?.total || 0)}
              </span>
              <div className="local-bar">
                <i style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
            </div>
          )}
          {info.status === 'error' && <p className="studio-error">{info.error}</p>}
          <div className="update-actions">
            <button className="orbi-btn" onClick={() => setNotes(true)}>
              {t('What’s new')}
            </button>
            {info.status === 'available' && (
              <button className="orbi-btn orbi-btn-primary" onClick={() => api.downloadUpdate()}>
                <ArrowDownToLine size={13} /> {t('Download')} {latest.asset ? `· ${fmtBytes(latest.asset.size)}` : ''}
              </button>
            )}
            {info.status === 'downloading' && (
              <button className="orbi-btn" onClick={() => api.cancelUpdate()}>
                {t('Pause')}
              </button>
            )}
            {info.status === 'ready' && (
              <button className="orbi-btn orbi-btn-primary" onClick={askInstall}>
                <RefreshCw size={13} /> {t('Install now')}
              </button>
            )}
            {info.status === 'installing' && (
              <span className="provider-status">
                <Loader2 size={12} className="inline animate-spin" /> {t('Installing…')}
              </span>
            )}
            {info.status === 'available-manual' && (
              <button className="orbi-btn orbi-btn-primary" onClick={() => api.openExternal(latest.url)}>
                {t('Open download page')}
              </button>
            )}
            {info.status === 'error' && (
              <button className="orbi-btn" onClick={() => api.downloadUpdate()}>
                {t('Try again')}
              </button>
            )}
          </div>
        </div>
      )}

      {notes && latest && (
        <div className="orbi-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setNotes(false)}>
          <div className="voice-dialog update-notes" role="dialog" aria-label={t('What’s new')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3>Orbi {latest.version}</h3>
                <p>{latest.name}</p>
              </div>
              <button className="icon-button" onClick={() => setNotes(false)} aria-label={t('Close')}>
                <X size={16} />
              </button>
            </div>
            <div className="update-notes-body">
              <Markdown text={latest.notes || t('No release notes.')} />
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="orbi-modal-backdrop">
          <div className="approval-dialog" role="alertdialog" aria-label={t('Install update')}>
            <div className="approval-icon">
              <RefreshCw size={20} />
            </div>
            <h3>{t('Install Orbi {v}?', { v: latest?.version || '' })}</h3>
            <p className="orbi-muted">{t('Orbi closes for a few seconds, installs the update and opens again. Your chats, images and models are kept. Your computer does not restart.')}</p>
            {confirm.length > 0 ? (
              <>
                <p className="orbi-label">{t('These will be paused or stopped:')}</p>
                <ul className="update-work">
                  {confirm.map((w, i) => (
                    <li key={i}>{w.label}</li>
                  ))}
                </ul>
                <p className="orbi-muted">{t('Downloads resume where they stopped. Unfinished generations need to be run again.')}</p>
              </>
            ) : (
              <p className="provider-status">
                <Check size={12} className="inline" /> {t('Nothing is running — safe to update.')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button className="orbi-btn" onClick={() => setConfirm(null)}>
                {t('Later')}
              </button>
              <button
                className="orbi-btn orbi-btn-primary"
                autoFocus
                onClick={() => {
                  setConfirm(null)
                  api.installUpdate()
                }}
              >
                {t('Update now')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Settings → About: version, manual check and the auto-check switch.
export function UpdateSection() {
  const info = useUpdates()
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    api.getSetting('autoUpdateCheck', true).then(setAuto)
  }, [])
  const busy = info?.status === 'checking'
  const label =
    !info || info.status === 'idle'
      ? ''
      : info.status === 'checking'
        ? t('Checking…')
        : info.status === 'current'
          ? t('You have the latest version.')
          : info.status === 'error'
            ? `${t('Could not check')}: ${info.error}`
            : t('Version {v} is available.', { v: info.latest?.version || '' })
  return (
    <div className="update-section">
      <div className="flex flex-wrap items-center gap-2">
        <button className="orbi-btn" disabled={busy} onClick={() => api.checkUpdate()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t('Check for updates')}
        </button>
        {label && <span className="orbi-muted">{label}</span>}
      </div>
      <label className="studio-check mt-2">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked)
            api.setSetting('autoUpdateCheck', e.target.checked)
          }}
        />
        {t('Check for new versions automatically')}
      </label>
    </div>
  )
}
