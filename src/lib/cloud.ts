// Orbi Cloud on the front end: the account state shared by every screen, and the model catalog.
import { useEffect, useState } from 'react'
import { api, type CloudCatalog, type CloudState } from './api'

/** Orbi runs on Orbi Cloud: market models, no personal API keys, no local engines in the interface. */
export const CLOUD_ONLY = true

let state: CloudState | null = null
let catalog: CloudCatalog | null = null
let loading: Promise<void> | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export async function refreshCloud() {
  state = await api.cloudState().catch((e) => ({ url: '', signedIn: false, user: null, payments: false, error: String(e?.message || e), code: 'offline' }))
  if (state.signedIn && state.user) catalog = await api.cloudCatalog().catch(() => catalog)
  emit()
  return state
}

/** Account state and catalog; refreshes every minute while a screen uses it. */
export function useCloud() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    subs.add(f)
    if (!state && !loading) loading = refreshCloud().then(() => void (loading = null))
    const tm = setInterval(() => document.visibilityState === 'visible' && refreshCloud(), 60000)
    return () => {
      subs.delete(f)
      clearInterval(tm)
    }
  }, [])
  return { state, catalog, refresh: refreshCloud }
}

export const fmtCredits = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n)

/** "720p" style label closest to a short side in pixels, within what the model supports. */
export function nearestRes(list: string[], short: number) {
  const px = (r: string) => (/^(\d+)p$/i.test(r) ? Number(r.slice(0, -1)) : /^(\d)K$/i.test(r) ? Number(r[0]) * 1080 : 720)
  return list.reduce((a, b) => (Math.abs(px(b) - short) < Math.abs(px(a) - short) ? b : a), list[0])
}
export const nearestDuration = (list: number[], s: number) => (list.length ? list.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), list[0]) : s)
