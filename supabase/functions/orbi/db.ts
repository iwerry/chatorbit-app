// Direct Postgres access with the function's own database URL (SUPABASE_DB_URL), as the service role.
import postgres from 'npm:postgres@3.4.5'
import { config, HttpError, MICRO } from './config.ts'

export const sql = postgres(config.dbUrl, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 })

export type Profile = {
  id: string
  email: string
  name: string
  created_at: Date
  stripe_customer: string | null
  plan: string | null
  plan_status: string | null
  subscription_id: string | null
  period_end: Date | null
  plan_balance: string | number
  extra_balance: string | number
  disabled: boolean
}

export const n = (v: unknown) => Number(v ?? 0)
export const balanceOf = (p: Profile) => n(p.plan_balance) + n(p.extra_balance)

export async function profile(id: string): Promise<Profile | undefined> {
  const [row] = await sql<Profile[]>`select * from public.profiles where id = ${id}`
  return row
}

export async function ensureProfile(id: string, email: string, name = ''): Promise<Profile> {
  const p = await profile(id)
  if (p) return p
  // Normally created by the signup trigger; this covers accounts made before the migration.
  await sql`insert into public.profiles (id, email, name) values (${id}, ${email}, ${name}) on conflict (id) do nothing`
  return (await profile(id))!
}

export const debit = (user: string, amount: number, cost: number, model: string, note: string, ref = '') =>
  amount > 0 ? sql`select public.debit_credits(${user}, ${amount}, ${cost}, ${model}, ${note}, ${ref})` : Promise.resolve()

export const addCredits = (user: string, bucket: 'plan' | 'extra', amount: number, kind: string, note = '', ref = '') =>
  sql`select public.add_credits(${user}, ${bucket}, ${amount}, ${kind}, ${note}, ${ref})`

export const resetPlanCredits = (user: string, credits: number, note: string, ref: string) =>
  sql`select public.reset_plan_credits(${user}, ${Math.round(credits * MICRO)}, ${note}, ${ref})`

export function requireCredits(p: Profile, needed = 1) {
  if (balanceOf(p) < needed * MICRO)
    throw new HttpError(402, p.plan ? 'You are out of credits. Buy extra credits or wait for your plan to renew.' : 'You are out of credits. Choose a plan to keep going.', 'no_credits')
}
