// Settings → Usage: Orbi credits spent in a period, by kind of work (text, image, video, audio) and by model.
// Credits are what Orbi charges; they are not the provider's bill, so no dollar figures are shown here.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { api, type CloudUsageSummary } from '../lib/api'
import { fmtCredits } from '../lib/cloud'
import { t } from '../lib/i18n'

const PERIODS = [7, 30, 90] as const
type Modality = 'text' | 'image' | 'video' | 'audio'
const MODALITY: Record<string, Modality> = { Chat: 'text', Image: 'image', Video: 'video', Voice: 'audio', 'Sound effect': 'audio', Music: 'audio', Dictation: 'audio' }
const MODALITY_LABEL: Record<Modality, string> = { text: 'Text', image: 'Images', video: 'Videos', audio: 'Audio' }
const modalityOf = (kind: string): Modality => MODALITY[kind] ?? 'text'
const shortModel = (id: string) => id.split('/').pop() || id

// When the summary endpoint is not available yet, build the same shape from the recent-use list.
async function loadSummary(days: number): Promise<CloudUsageSummary> {
  try {
    return await api.cloudUsageSummary(days)
  } catch {
    const since = Date.now() - days * 86_400_000
    const rows = (await api.cloudUsage()).items.filter((r) => r.amount < 0 && r.created_at >= since)
    const add = <K extends string>(m: Map<K, { credits: number; calls: number }>, k: K, v: number) => {
      const cur = m.get(k) ?? { credits: 0, calls: 0 }
      m.set(k, { credits: cur.credits + v, calls: cur.calls + 1 })
    }
    const kinds = new Map<string, { credits: number; calls: number }>()
    const models = new Map<string, { credits: number; calls: number }>()
    const kindOfModel = new Map<string, string>()
    const daysMap = new Map<number, number>()
    for (const r of rows) {
      const kind = (r.note || 'Other').replace(/ \(est\.\)$/, '')
      add(kinds, kind, -r.amount)
      if (r.model) {
        add(models, r.model, -r.amount)
        kindOfModel.set(r.model, kind)
      }
      const d = new Date(r.created_at)
      d.setHours(0, 0, 0, 0)
      daysMap.set(d.getTime(), (daysMap.get(d.getTime()) ?? 0) - r.amount)
    }
    return {
      days,
      total: { credits: rows.reduce((s, r) => s - r.amount, 0), calls: rows.length },
      byKind: [...kinds].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.credits - a.credits),
      byModel: [...models].map(([model, v]) => ({ model, kind: kindOfModel.get(model) || 'Other', ...v })).sort((a, b) => b.credits - a.credits).slice(0, 25),
      byDay: [...daysMap].map(([day, credits]) => ({ day, credits })).sort((a, b) => a.day - b.day),
    }
  }
}

export function UsagePanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [data, setData] = useState<CloudUsageSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    setError('')
    loadSummary(days)
      .then(setData)
      .catch((e) => setError(String((e as Error)?.message || e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [days])

  const byModality = useMemo(() => {
    const m: Record<Modality, { credits: number; calls: number }> = { text: { credits: 0, calls: 0 }, image: { credits: 0, calls: 0 }, video: { credits: 0, calls: 0 }, audio: { credits: 0, calls: 0 } }
    for (const k of data?.byKind ?? []) {
      const x = m[modalityOf(k.kind)]
      x.credits += k.credits
      x.calls += k.calls
    }
    return (Object.keys(m) as Modality[]).map((id) => ({ id, ...m[id] }))
  }, [data])
  const total = data?.total.credits ?? 0
  const peak = Math.max(1, ...(data?.byDay ?? []).map((d) => d.credits))
  const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return (
    <div className="usage">
      <div className="usage-head">
        <div className="usage-periods" role="radiogroup" aria-label={t('Period')}>
          {PERIODS.map((d) => (
            <button key={d} role="radio" aria-checked={days === d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
              {t('{n} days', { n: d })}
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={load} disabled={loading} title={t('Refresh')} aria-label={t('Refresh')}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
      </div>

      {error ? (
        <p className="orbi-muted">{t('Could not load your usage. Check your internet and try again.')}</p>
      ) : !data ? (
        <div className="hub-skeleton" />
      ) : (
        <>
          <div className="usage-total">
            <strong className="num">{fmtCredits(total)}</strong>
            <span>{t('credits used in the last {n} days', { n: data.days })}</span>
            <small className="num">{data.total.calls === 1 ? t('1 request') : t('{n} requests', { n: data.total.calls })}</small>
          </div>

          <p className="orbi-label">{t('By type')}</p>
          <ul className="usage-bars">
            {byModality.map((m) => (
              <li key={m.id} className={`kind-${m.id}`}>
                <span className="usage-bar-label">{t(MODALITY_LABEL[m.id])}</span>
                <span className="usage-bar-track" aria-hidden>
                  <i style={{ width: `${total ? (m.credits / total) * 100 : 0}%` }} />
                </span>
                <em className="num">{fmtCredits(m.credits)}</em>
              </li>
            ))}
          </ul>

          {data.byDay.length > 1 && (
            <>
              <p className="orbi-label">{t('By day')}</p>
              <div className="usage-days" role="img" aria-label={t('Credits used per day')}>
                {data.byDay.map((d) => (
                  <i key={d.day} style={{ height: `${Math.max(4, (d.credits / peak) * 100)}%` }} title={`${fmtDay(d.day)} · ${fmtCredits(d.credits)}`} />
                ))}
              </div>
            </>
          )}

          <p className="orbi-label">{t('By model')}</p>
          {data.byModel.length === 0 ? (
            <p className="orbi-muted">{t('Nothing yet.')}</p>
          ) : (
            <ul className="acct-usage">
              {data.byModel.map((m) => (
                <li key={m.model}>
                  <span className="truncate" title={m.model}>
                    <span className={`usage-dot kind-${modalityOf(m.kind)}`} aria-hidden />
                    {shortModel(m.model)}
                    <small> · {t(m.kind)}</small>
                  </span>
                  <small className="num">{m.calls === 1 ? t('1 request') : t('{n} requests', { n: m.calls })}</small>
                  <em className="num">{fmtCredits(m.credits)}</em>
                </li>
              ))}
            </ul>
          )}
          <p className="orbi-muted mt-3">{t('Credits are what Orbi charges for each request. They are not the AI provider’s bill.')}</p>
        </>
      )}
    </div>
  )
}
