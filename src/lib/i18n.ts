// Tiny i18n: English strings are the keys. Missing translations fall back to English.
// Interpolation: t('Hello, {name}', { name }) .
import { DICTS } from './i18n-dicts'

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
] as const
export type Lang = (typeof LANGUAGES)[number]['id']

let current: Lang = 'en'

export function setLang(l: Lang) {
  current = LANGUAGES.some((x) => x.id === l) ? l : 'en'
  document.documentElement.lang = current
}
export function getLang(): Lang {
  return current
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = current === 'en' ? null : DICTS[current]
  let s = (dict && dict[key]) || key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

// Locale-aware formats used across the UI.
export function fmtDate(ts: number, style: 'medium' | 'long' | 'full' = 'medium') {
  return new Intl.DateTimeFormat(current, { dateStyle: style }).format(new Date(ts))
}
export function fmtTime(ts: number) {
  return new Intl.DateTimeFormat(current, { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}
export function fmtBytes(n: number) {
  if (!n) return ''
  const gb = n / 1e9
  return gb >= 1 ? `${new Intl.NumberFormat(current, { maximumFractionDigits: 1 }).format(gb)} GB` : `${Math.round(n / 1e6)} MB`
}
export function fmtMonth(ts: number) {
  return new Intl.DateTimeFormat(current, { month: 'long' }).format(new Date(ts))
}
