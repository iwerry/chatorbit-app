// Who is calling: checks the Supabase session token with the Auth server, then loads the profile.
import { config, HttpError, MICRO } from './config.ts'
import { balanceOf, ensureProfile, n, type Profile } from './db.ts'
import { plans } from './config.ts'

export type Caller = { id: string; email: string; profile: Profile; admin: boolean }

export async function caller(req: Request): Promise<Caller> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Sign in to Orbi to continue.', 'signed_out')
  const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: config.anonKey || req.headers.get('apikey') || '' } })
  if (!res.ok) throw new HttpError(401, 'Your session ended. Sign in again.', 'signed_out')
  const u = (await res.json()) as { id: string; email?: string; user_metadata?: { name?: string } }
  const profile = await ensureProfile(u.id, u.email || '', u.user_metadata?.name || '')
  if (profile.disabled) throw new HttpError(403, 'This account is disabled.', 'disabled')
  return { id: u.id, email: (u.email || '').toLowerCase(), profile, admin: config.admins.includes((u.email || '').toLowerCase()) }
}

export function publicUser(c: Caller) {
  const p = c.profile
  const plan = plans.find((x) => x.id === p.plan)
  const active = !!p.plan && ['active', 'trialing', 'past_due'].includes(p.plan_status || '')
  return {
    id: p.id,
    email: p.email || c.email,
    name: p.name,
    admin: c.admin,
    plan: active ? { id: p.plan, name: plan?.name || p.plan, status: p.plan_status, renews: p.period_end ? new Date(p.period_end).getTime() : null, monthlyCredits: plan?.monthlyCredits ?? 0 } : null,
    credits: { plan: n(p.plan_balance) / MICRO, extra: n(p.extra_balance) / MICRO, total: balanceOf(p) / MICRO },
    created: new Date(p.created_at).getTime(),
  }
}
