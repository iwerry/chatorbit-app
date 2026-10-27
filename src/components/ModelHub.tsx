import { useEffect, useState } from 'react'
import { AudioLines, Check, Cpu, Download, FolderOpen, HardDrive, Image as ImageIcon, Link2, Loader2, MemoryStick, MessageSquareText, Mic, MonitorCog, RefreshCw, Volume2, Search, Sparkles, Square, Trash2, Video, X } from 'lucide-react'
import { api, type HfFile, type HfRepo, type LocalModel, type LocalStatus, type ModelKind } from '../lib/api'
import { fmtBytes, t } from '../lib/i18n'
import { sampleFor, speak } from '../lib/tts'

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

function ModelRow({ m, recommended, queued, onChanged }: { m: LocalModel; recommended: boolean; queued: boolean; onChanged: () => void }) {
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
          {m.vision && <span className="hub-badge">{t('Sees images')}</span>}
          <span className="hub-meta num">{[fmtBytes(m.size), m.req?.ram ? `${m.req.ram} GB RAM` : '', m.req?.vram ? `${m.req.vram} GB VRAM` : '', m.license].filter(Boolean).join(' · ')}</span>
        </p>
        <p className="hub-desc">{t(m.description)}</p>
        {!m.installed && !m.downloading && !!m.partial && (
          <p className="hub-note num">
            {t('{size} already downloaded — Download continues where it stopped.', { size: fmtBytes(m.partial) })}{' '}
            <button className="link-btn" onClick={() => run(() => api.removeLocal(m.id))}>
              {t('Discard')}
            </button>
          </p>
        )}
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
            {m.vision && !m.visionReady && !m.downloading && (
              <button className="orbi-btn" disabled={busy} onClick={() => run(() => api.installLocalModel(m.id))} title={t('Downloads the image projector (≈0.8 GB)')}>
                <ImageIcon size={13} /> {t('Enable image input')}
              </button>
            )}
            {m.downloading && <span className="provider-status num">{pct}%</span>}
            {m.kind === 'tts' && (
              <button className="orbi-btn" title={t('Listen')} onClick={() => speak(sampleFor(m.lang || 'en'), { type: 'piper', modelId: m.id, rate: 1 }, m.lang || 'en').catch((e) => setError(cleanErr(e)))}>
                <Volume2 size={13} />
              </button>
            )}
            <span className="provider-status">
              <Check size={12} className="inline" /> {t('Ready')}
            </span>
            <button className="orbi-btn" title={t('Delete')} aria-label={t('Delete')} onClick={() => run(() => api.removeLocal(m.id))}>
              <Trash2 size={13} />
            </button>
          </>
        ) : queued && !m.downloading ? (
          <span className="provider-status">{t('Queued')}</span>
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
          <button className={`orbi-btn ${recommended ? 'orbi-btn-primary' : ''}`} disabled={busy} onClick={() => run(() => api.installLocalModel(m.id))}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t('Download')}
          </button>
        )}
      </div>
    </div>
  )
}

export function ModelHub({ status, onChanged, initialTab = 'text', onOpenSetup }: { status: LocalStatus | null; onChanged: () => void; initialTab?: Tab; onOpenSetup?: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  if (!status) return <div className="hub-skeleton" aria-busy="true" />
  const models = status.models.filter((m) => m.kind === tab)
  const engineKey = tab === 'text' ? 'llama' : tab === 'stt' ? 'whisper' : tab === 'audio' ? 'piper' : 'sd'
  const engine = engineKey ? status.engines[engineKey] : null
  return (
    <div className="model-hub">
      <HardwareCard status={status} onRefresh={() => api.refreshHardware().then(onChanged)} />
      <div className="hub-toolbar">
        {onOpenSetup && (
          <button className="orbi-btn orbi-btn-primary" onClick={onOpenSetup}>
            <Sparkles size={13} /> {t('Recommended setup for this PC')}
          </button>
        )}
        <button className="orbi-btn" onClick={() => api.openModelsFolder()} title={status.paths?.root}>
          <FolderOpen size={13} /> {t('Open models folder')}
        </button>
        <button
          className="orbi-btn hub-danger"
          onClick={async () => {
            if (!confirm(t('Delete every downloaded model and engine? Your chats and images are kept.'))) return
            await api.removeAllLocal()
            onChanged()
          }}
        >
          <Trash2 size={13} /> {t('Delete all models')}
        </button>
        {!!status.orphans?.bytes && (
          <button
            className="orbi-btn"
            title={status.orphans.files.map((f) => f.file).join('\n')}
            onClick={async () => {
              await api.cleanOrphans()
              onChanged()
            }}
          >
            <Trash2 size={13} /> {t('Free {size} of unused files', { size: fmtBytes(status.orphans.bytes) })}
          </button>
        )}
      </div>
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
          {status.models
            .filter((m) => m.kind === 'tts')
            .map((m) => (
              <ModelRow key={m.id} m={m} recommended={false} queued={!!status.queue?.includes(m.id)} onChanged={onChanged} />
            ))}
          <p className="hub-note">{t('Pick the default voice and listen to each one in Settings → Voice.')}</p>
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
                <ModelRow key={m.id} m={m} recommended={status.recommended[m.kind] === m.id} queued={status.queue?.includes(m.id)} onChanged={onChanged} />
              ))}
            </div>
          )
        })
      )}

      {tab === 'image' && status.models.some((m) => m.kind === 'upscale') && (
        <div className="hub-group">
          <p className="hub-tier">
            {t('Upscalers')}
            <small>{t('Make images bigger and sharper')}</small>
          </p>
          {status.models
            .filter((m) => m.kind === 'upscale')
            .map((m) => (
              <ModelRow key={m.id} m={m} recommended={false} queued={!!status.queue?.includes(m.id)} onChanged={onChanged} />
            ))}
        </div>
      )}
      {(tab === 'text' || tab === 'image') && <HfSearch kind={tab} onChanged={onChanged} />}
    </div>
  )
}

// Search Hugging Face and install any compatible file (GGUF for text, single-file checkpoints for images).
function HfSearch({ kind, onChanged }: { kind: 'text' | 'image'; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<HfRepo[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [files, setFiles] = useState<HfFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  useEffect(() => {
    setResults(null)
    setOpen(null)
    setFiles(null)
  }, [kind])
  const search = async () => {
    setBusy(true)
    setError(null)
    setOpen(null)
    try {
      setResults(await api.hfSearch(q.trim(), kind))
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }
  const openRepo = async (repo: string) => {
    if (open === repo) return setOpen(null)
    setOpen(repo)
    setFiles(null)
    try {
      setFiles(await api.hfFiles(repo, kind))
    } catch (e) {
      setError(cleanErr(e))
    }
  }
  const install = async (input: Parameters<typeof api.addCustomLocal>[0]) => {
    setError(null)
    try {
      const p = api.addCustomLocal(input)
      onChanged()
      await p
      onChanged()
    } catch (e) {
      setError(cleanErr(e))
    }
  }
  return (
    <div className="hf-box">
      <p className="hub-tier">
        {t('Search Hugging Face')}
        <small>{kind === 'text' ? t('Any GGUF chat model') : t('Single-file SD 1.5 / SDXL checkpoints')}</small>
      </p>
      <form
        className="hf-row"
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
      >
        <label className="orbi-field flex-1">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'text' ? t('e.g. qwen, gemma, llama, mistral') : t('e.g. dreamshaper, juggernaut, realvis')} spellCheck={false} />
        </label>
        <button className="orbi-btn" disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} {t('Search')}
        </button>
      </form>
      {results && !results.length && <p className="hub-note">{t('Nothing found. Try another name.')}</p>}
      {results && results.length > 0 && (
        <ul className="hf-results">
          {results.map((r) => (
            <li key={r.repo} className={open === r.repo ? 'open' : ''}>
              <button className="hf-repo" onClick={() => openRepo(r.repo)}>
                <strong>{r.repo}</strong>
                <span className="num">↓ {new Intl.NumberFormat().format(r.downloads)}</span>
              </button>
              {open === r.repo && (
                <div className="hf-files">
                  {!files && <Loader2 size={14} className="animate-spin" />}
                  {files && !files.length && <p className="hub-note">{t('No compatible files in this repository.')}</p>}
                  {files?.map((f) => (
                    <div key={f.file} className={`hf-file ${f.fits ? '' : 'too-big'}`}>
                      <span className="min-w-0 flex-1 truncate" title={f.file}>
                        {f.quant && <em className="hub-badge">{f.quant}</em>} {f.file}
                      </span>
                      <span className="hub-meta num">{fmtBytes(f.size)}</span>
                      <button className={`orbi-btn ${f.fits ? 'orbi-btn-primary' : ''}`} onClick={() => install({ repo: r.repo, file: f.file, size: f.size, kind, name: `${r.repo.split('/')[1]} ${f.quant}`.trim() })}>
                        <Download size={12} /> {f.fits ? t('Install') : t('Install anyway')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="hf-row">
        <label className="orbi-field flex-1">
          <Link2 size={14} />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t('…or paste a direct file link from Hugging Face')} spellCheck={false} />
        </label>
        <button className="orbi-btn" disabled={!link.trim()} onClick={() => install({ url: link.trim(), kind }).then(() => setLink(''))}>
          <Download size={13} /> {t('Add')}
        </button>
      </div>
      {error && <p className="provider-status provider-status-error">{error}</p>}
    </div>
  )
}
