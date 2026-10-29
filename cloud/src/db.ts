// Native SQLite (node:sqlite) in WAL mode: accounts, sessions, subscriptions, the credit ledger and jobs.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { config } from './config.ts'

mkdirSync(dirname(config.dbFile), { recursive: true })
export const db = new DatabaseSync(config.dbFile)
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL DEFAULT '',
     password TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     stripe_customer TEXT,
     plan TEXT,
     plan_status TEXT,
     subscription_id TEXT,
     period_end INTEGER,
     plan_balance INTEGER NOT NULL DEFAULT 0,
     extra_balance INTEGER NOT NULL DEFAULT 0,
     disabled INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     device TEXT NOT NULL DEFAULT ''
   );
   CREATE TABLE ledger (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     kind TEXT NOT NULL,
     amount INTEGER NOT NULL,
     cost_usd REAL NOT NULL DEFAULT 0,
     model TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     ref TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX ledger_user ON ledger(user_id, created_at DESC);
   CREATE TABLE video_jobs (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     model TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     status TEXT NOT NULL,
     charged INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE stripe_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`,
]

db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
const version = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value || 0)
for (let i = version; i < MIGRATIONS.length; i++) {
  db.exec('BEGIN')
  try {
    db.exec(MIGRATIONS[i])
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(i + 1))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const uid = () => randomBytes(12).toString('base64url')

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export type User = {
  id: string
  email: string
  name: string
  password: string
  created_at: number
  stripe_customer: string | null
  plan: string | null
  plan_status: string | null
  subscription_id: string | null
  period_end: number | null
  plan_balance: number
  extra_balance: number
  disabled: number
}
