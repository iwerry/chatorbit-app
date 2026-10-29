// Settings from the environment (.env) and plans.json.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env

export type Plan = { id: string; name: string; priceLabel: string; monthlyCredits: number; stripePriceEnv: string; features: string[]; stripePrice?: string }
export type Pack = { id: string; name: string; priceLabel: string; credits: number; stripePriceEnv: string; stripePrice?: string }

const plansFile = JSON.parse(readFileSync(env.PLANS_FILE || join(ROOT, 'plans.json'), 'utf8')) as { plans: Plan[]; packs: Pack[] }

export const config = {
  port: Number(env.PORT || 8787),
  publicUrl: (env.PUBLIC_URL || `http://127.0.0.1:${env.PORT || 8787}`).replace(/\/+$/, ''),
  dbFile: env.DB_FILE || join(ROOT, 'data', 'orbi-cloud.db'),
  openrouterKey: env.OPENROUTER_API_KEY || '',
  openrouterBase: (env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  appName: env.APP_NAME || 'Orbi',
  appUrl: env.APP_URL || 'https://github.com/iwerry/chatorbit-app',
  markup: Number(env.MARKUP || 1.25),
  creditUsd: Number(env.CREDIT_USD || 0.001),
  trialCredits: Number(env.TRIAL_CREDITS ?? 300),
  adminToken: env.ADMIN_TOKEN || '',
  stripeKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  stripeBase: (env.STRIPE_BASE || 'https://api.stripe.com').replace(/\/+$/, ''),
  chatModels: (env.CHAT_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  plans: plansFile.plans.map((p) => ({ ...p, stripePrice: env[p.stripePriceEnv] || '' })),
  packs: plansFile.packs.map((p) => ({ ...p, stripePrice: env[p.stripePriceEnv] || '' })),
}

/** Micro-credits are the integer unit stored in the ledger (1 credit = 1,000,000 µcr). */
export const MICRO = 1_000_000
/** OpenRouter cost in USD → micro-credits charged to the user (with markup). */
export const chargeFor = (costUsd: number) => Math.max(0, Math.round(((costUsd * config.markup) / config.creditUsd) * MICRO))
/** USD price → credits shown in the catalog. */
export const creditsFor = (usd: number) => (usd * config.markup) / config.creditUsd
