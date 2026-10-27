import { useState } from 'react'
import { AudioLines, Check, Cpu, Download, HardDrive, Image as ImageIcon, Link2, Loader2, MemoryStick, MessageSquareText, Mic, MonitorCog, RefreshCw, Square, Trash2, Video, X } from 'lucide-react'
import { api, type LocalModel, type LocalStatus, type ModelKind } from '../lib/api'
import { fmtBytes, t } from '../lib/i18n'

type Tab = ModelKind | 'audio'
const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: 'text', label: 'Text', icon: MessageSquareText },
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'stt', label: 'Voice input', icon: Mic },
  { id: 'audio', label: 'Voice output', icon: AudioLines },
]
const TIERS = ['light', 'medium', 'heavy', 'custom'] as const
const TIER_LABEL: Record<string, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy', custom: 'Custom' }

function cleanErr(e: unknown) {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function HardwareCard({ status, onRefresh }: { status: LocalStatus | null; onRefresh?: () => void }) {
  const hw = status?.hardware
  if (!hw) return null
  const gpu = hw.gpus[0]
  return (
    <div className="hw-card">
      <div className="hw-item">
        <Cpu size={15} />
        <span>
          <small>{t('Processor')}</small>
          <strong title={hw.cpu}>{hw.cpu.replace(/\(R\)|\(TM\)|CPU|Processor/gi, '').replace(/\s+/g, ' ').trim()}</strong>
          <em>{t('{n} threads', { n: hw.cores })}</em>
        </span>
      </div>
      <div className="hw-item">
        <MemoryStick size={15} />
        <span>
          <small>{t('Memory')}</small>
          <strong className="num">{hw.ram} GB</strong>
          <em>RAM</em>
        </span>
      </div>
      <div className="hw-item">
        <MonitorCog size={15} />
        <span>
          <small>{t('Graphics')}</small>
          <strong title={gpu?.name}>{gpu ? gpu.name : t('No dedicated GPU')}</strong>
          <em className="num">{hw.vram ? `${hw.vram} GB VRAM` : t('runs on CPU')}</em>
        </span>
      </div>
      <div className="hw-item">
        <HardDrive size={15} />
        <span>
          <small>{t('Free disk')}</small>
          <strong className="num">{hw.diskFree} GB</strong>
          <em>{hw.os}</em>
        </span>
      </div>
      {onRefresh && (
        <button className="hw-refresh" onClick={onRefresh} title={t('Detect again')} aria-label={t('Detect again')}>
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  )
}

function ModelRow({ m, recommended, onChanged }: { m: LocalModel; recommended: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
      onChanged()
    } catch (e) {
      const msg = cleanErr(e)
      if (!/abort/i.test(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }
  const pct = m.downloading?.total ? Math.round((m.downloading.received / m.downloading.total) * 100) : 0
  const blocked = m.fit.level === 'no'
  return (
    <div className={`hub-model fit-${m.fit.level} ${m.installed ? 'installed' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="hub-model-title">
          <strong>{m.name}</strong>
          {recommended && !m.installed && <span className="hub-badge hub-badge-rec">{t('Recommended')}</span>}
          <span className="hub-meta num">{[fmtBytes(m.size), m.req?.ram ? `${m.req.ram} GB RAM` : '', m.req?.vram ? `${m.req.vram} GB VRAM` : '', m.license].filter(Boolean).join(' · ')}</span>
        </p>
        <p className="hub-desc">{t(m.description)}</p>
        <p className={`hub-fit hub-fit-${m.fit.level}`}>
          <i />
          {m.engineSupported ? t(m.fit.reason, m.fit.vars) : t('No local engine for this system yet — use a cloud provider.')}
        </p>
        {m.downloading && (
          <div className="local-progress">
            <span className="num">
              {m.downloading.label} · {pct}%
            </span>
            <div className="local-bar">
              <i style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
          </div>
        )}
        {error && <p className="provider-status provider-status-error mt-1">{error}</p>}
      </div>
      <div className="hub-actions">
        {m.installed ? (
          <>
            <span className="provider-status">
              <Check size={12} className="inline" /> {t('Ready')}
            </span>
            <button className="orbi-btn" title={t('Delete')} aria-label={t('Delete')} onClick={() => run(() => api.removeLocal(m.id))}>
              <Trash2 size={13} />
            </button>
          </>
        ) : m.downloading ? (
          <button className="orbi-btn" onClick={() => api.cancelLocal(m.id)}>
            <X size={13} /> {t('Cancel')}
          </button>
        ) : !m.engineSupported ? (
          <button className="orbi-btn" disabled>
            {t('Unavailable')}
          </button>
        ) : blocked ? (
          <button className="orbi-btn" disabled={busy} onClick={() => confirm(t('This model probably will not run on this PC. Download anyway?')) && run(() => api.installLocalModel(m.id))}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('Install anyway')}
          </button>
        ) : (
          <button className="orbi-btn orbi-btn-primary" disabled={busy} onClick={() => run(() => api.installLocalModel(m.id))}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('Download')}
          </button>
        )}
      </div>
    </div>
  )
}

export function ModelHub({ status, onChanged, initialTab = 'text' }: { status: LocalStatus | null; onChanged: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  if (!status) return <div className="hub-skeleton" aria-busy="true" />
  const models = status.models.filter((m) => m.kind === tab)
  const engineKey = tab === 'text' ? 'llama' : tab === 'stt' ? 'whisper' : tab === 'audio' ? null : 'sd'
  const engine = engineKey ? status.engines[engineKey] : null
  return (
    <div className="model-hub">
      <HardwareCard status={status} onRefresh={() => api.refreshHardware().then(onChanged)} />
      <div className="hub-tabs" role="tablist">
        {TABS.map((x) => {
          const Icon = x.icon
          const count = x.id === 'audio' ? 0 : status.models.filter((m) => m.kind === x.id && m.installed).length
          return (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
              <Icon size={14} />
              {t(x.label)}
              {count > 0 && <span className="hub-count num">{count}</span>}
            </button>
          )
        })}
      </div>

      {engine && (
        <p className="hub-engine">
          {t('Engine')}: <strong>{engine.name}</strong> <span className="num">{engine.tag}</span> ·{' '}
          {engine.installed ? t('installed') : engine.downloading ? `${t('downloading')} ${Math.round((engine.downloading.received / (engine.downloading.total || 1)) * 100)}%` : engine.supported ? t('downloads with the first model') : t('not available for this system')}
          {status.running && tab === 'text' && (
            <button className="hub-stop" onClick={() => api.stopLocal().then(onChanged)}>
              <Square size={10} /> {t('Stop {model}', { model: status.running.modelId })}
            </button>
          )}
        </p>
      )}

      {tab === 'audio' ? (
        <div className="hub-group">
          <div className="hub-model installed fit-ok">
            <div className="min-w-0 flex-1">
              <p className="hub-model-title">
                <strong>{t('System voices')}</strong>
                <span className="hub-meta">{t('Built in · 0 MB')}</span>
              </p>
              <p className="hub-desc">{t('Read answers aloud with the voices already installed on your computer. Click the speaker icon under any answer.')}</p>
            </div>
            <span className="provider-status">
              <Check size={12} className="inline" /> {t('Ready')}
            </span>
          </div>
          <p className="hub-note">{t('Natural local voices (Kokoro, OuteTTS) are planned for a next update.')}</p>
        </div>
      ) : (
        TIERS.map((tier) => {
          const list = models.filter((m) => m.tier === tier)
          if (!list.length) return null
          return (
            <div className="hub-group" key={tier}>
              <p className="hub-tier">
                {t(TIER_LABEL[tier])}
                <small>{tier === 'light' ? t('Any PC') : tier === 'medium' ? t('8–16 GB RAM') : tier === 'heavy' ? t('Strong GPU') : ''}</small>
              </p>
              {list.map((m) => (
                <ModelRow key={m.id} m={m} recommended={status.recommended[m.kind] === m.id} onChanged={onChanged} />
              ))}
            </div>
          )
        })
      )}

      {tab === 'text' && (
        <div className="hub-custom">
          <label className="orbi-field">
            <Link2 size={14} />
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('Paste a .gguf link from Hugging Face')} spellCheck={false} />
          </label>
          <button
            className="orbi-btn"
            disabled={!custom.trim()}
            onClick={async () => {
              setCustomError(null)
              try {
                await api.addCustomLocal(custom.trim())
                setCustom('')
                onChanged()
              } catch (e) {
                setCustomError(cleanErr(e))
              }
            }}
          >
            <Download size={13} /> {t('Add')}
          </button>
          {customError && <p className="provider-status provider-status-error">{customError}</p>}
        </div>
      )}
    </div>
  )
}
