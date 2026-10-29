// Accounts, sessions and the credit ledger.
// Two buckets: plan credits (reset at each renewal) and extra credits (bought packs, never expire).
// Usage spends plan credits first.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { config, MICRO } from './config.ts'
import { db, tx, uid, type User } from './db.ts'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
const SESSION_DAYS = 90

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.status = status
    this.code = code
  }
}

async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  const key = await scryptAsync(pw, salt, 32)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}
async function checkPassword(pw: string, stored: string) {
  const [, salt, key] = stored.split('$')
  if (!salt || !key) return false
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), 32)
  const want = Buffer.from(key, 'base64')
  return got.length === want.length && timingSafeEqual(got, want)
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
export const userByEmail = (email: string) => db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as User | undefined

function newSession(userId: string, device = '') {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, device) VALUES (?,?,?,?,?)').run(sha(token), userId, now, now + SESSION_DAYS * 86400000, device.slice(0, 80))
  return token
}

export async function signup(email: string, password: string, name = '', device = '') {
  email = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email.', 'bad_email')
  if (String(password || '').length < 8) throw new HttpError(400, 'Use a password with at least 8 characters.', 'weak_password')
  if (userByEmail(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.', 'exists')
  const id = uid()
  const hash = await hashPassword(password)
  tx(() => {
    db.prepare('INSERT INTO users (id, email, name, password, created_at) VALUES (?,?,?,?,?)').run(id, email, String(name || '').slice(0, 80), hash, Date.now())
    if (config.trialCredits > 0) credit(id, 'plan', Math.round(config.trialCredits * MICRO), 'trial', 'Welcome credits')
  })
  return { token: newSession(id, device), user: publicUser(getUser(id)!) }
}

export async function login(email: string, password: string, device = '') {
  const u = userByEmail(String(email || '').toLowerCase())
  if (!u || !(await checkPassword(String(password || ''), u.password))) throw new HttpError(401, 'Wrong email or password.', 'bad_login')
  if (u.disabled) throw new HttpError(403, 'This account is disabled.', 'disabled')
  return { token: newSession(u.id, device), user: publicUser(u) }
}

export function logout(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token))
}

export function userFromToken(token: string | undefined): User {
  if (!token) throw new HttpError(401, 'Sign in to Orbi to continue.', 'signed_out')
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(sha(token), Date.now()) as User | undefined
  if (!row) throw new HttpError(401, 'Your session ended. Sign in again.', 'signed_out')
  if (row.disabled) throw new HttpError(403, 'This account is disabled.', 'disabled')
  return row
}

export const balanceOf = (u: User) => u.plan_balance + u.extra_balance

export function publicUser(u: User) {
  const plan = config.plans.find((p) => p.id === u.plan)
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    plan: u.plan && u.plan_status && ['active', 'trialing', 'past_due'].includes(u.plan_status) ? { id: u.plan, name: plan?.name || u.plan, status: u.plan_status, renews: u.period_end, monthlyCredits: plan?.monthlyCredits ?? 0 } : null,
    credits: { plan: u.plan_balance / MICRO, extra: u.extra_balance / MICRO, total: balanceOf(u) / MICRO },
    created: u.created_at,
  }
}

/** Adds credits to a bucket (amount in micro-credits). */
export function credit(userId: string, bucket: 'plan' | 'extra', amount: number, kind: string, note = '', ref = '') {
  db.prepare(`UPDATE users SET ${bucket}_balance = ${bucket}_balance + ? WHERE id = ?`).run(amount, userId)
  db.prepare('INSERT INTO ledger (user_id, created_at, kind, amount, note, ref) VALUES (?,?,?,?,?,?)').run(userId, Date.now(), kind, amount, note, ref)
}

/** Sets plan credits to the monthly allowance (renewal). Unused plan credits do not roll over. */
export function resetPlanCredits(userId: string, credits: number, ref: string) {
  tx(() => {
    const u = getUser(userId)!
    const amount = Math.round(credits * MICRO)
    db.prepare('UPDATE users SET plan_balance = ? WHERE id = ?').run(amount, userId)
    db.prepare('INSERT INTO ledger (user_id, created_at, kind, amount, note, ref) VALUES (?,?,?,?,?,?)').run(userId, Date.now(), 'renewal', amount - Math.max(0, u.plan_balance), `Monthly credits (${credits})`, ref)
  })
}

/** Charges usage: plan credits first, then extra. May go slightly negative on the last call. */
export function debit(userId: string, amount: number, costUsd: number, model: string, note: string, ref = '') {
  if (amount <= 0) return
  tx(() => {
    const u = getUser(userId)!
    const fromPlan = Math.min(Math.max(0, u.plan_balance), amount)
    db.prepare('UPDATE users SET plan_balance = plan_balance - ?, extra_balance = extra_balance - ? WHERE id = ?').run(fromPlan, amount - fromPlan, userId)
    db.prepare('INSERT INTO ledger (user_id, created_at, kind, amount, cost_usd, model, note, ref) VALUES (?,?,?,?,?,?,?,?)').run(userId, Date.now(), 'usage', -amount, costUsd, model, note, ref)
  })
}

export function requireCredits(u: User, needed = 1) {
  if (balanceOf(u) < needed * MICRO)
    throw new HttpError(402, u.plan ? 'You are out of credits. Buy extra credits or wait for your plan to renew.' : 'You are out of credits. Choose a plan to keep going.', 'no_credits')
}

export function usageOf(userId: string, limit = 100) {
  return (db.prepare('SELECT created_at, kind, amount, model, note FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit) as { created_at: number; kind: string; amount: number; model: string; note: string }[]).map((r) => ({ ...r, amount: r.amount / MICRO }))
}
