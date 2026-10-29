// Settings from Supabase secrets (Project Settings › Edge Functions › Secrets).
const env = (k: string, d = '') => Deno.env.get(k) ?? d

export type Plan = { id: string; name: string; priceLabel: string; monthlyCredits: number; features: string[]; stripePrice: string }
export type Pack = { id: string; name: string; priceLabel: string; credits: number; stripePrice: string }

export const config = {
  supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
  anonKey: env('SUPABASE_ANON_KEY'),
  dbUrl: env('SUPABASE_DB_URL'),
  /** Read on every use, so a secret saved in the dashboard works without redeploying. Spaces and line breaks are ignored. */
  get openrouterKey() {
    return (env('OPENROUTER_API_KEY') || env('OPENROUTER_KEY')).trim()
  },
  openrouterBase: env('OPENROUTER_BASE', 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  appName: env('APP_NAME', 'Orbi'),
  appUrl: env('APP_URL', 'https://github.com/iwerry/chatorbit-app'),
  markup: Number(env('MARKUP', '1.25')),
  creditUsd: Number(env('CREDIT_USD', '0.001')),
  get admins() {
    return env('ADMIN_EMAILS').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  },
  stripeKey: env('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET'),
  stripeBase: env('STRIPE_BASE', 'https://api.stripe.com').replace(/\/+$/, ''),
  chatModels: env('CHAT_MODELS').split(',').map((s) => s.trim()).filter(Boolean),
  /** Public address of this function, used in Stripe return pages and video links. */
  publicUrl: env('PUBLIC_URL') || `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/orbi`,
}

// Plans and packs. Prices are starting hypotheses; the real price is the Stripe price id in the secrets.
export const plans: Plan[] = [
  { id: 'pro', name: 'Pro', priceLabel: env('PRO_LABEL', 'US$ 19/mês'), monthlyCredits: Number(env('PRO_CREDITS', '15000')), features: ['All chat models', 'Images and videos', 'Voice and dictation'], stripePrice: env('STRIPE_PRICE_PRO') },
  { id: 'studio', name: 'Studio', priceLabel: env('STUDIO_LABEL', 'US$ 49/mês'), monthlyCredits: Number(env('STUDIO_CREDITS', '45000')), features: ['Everything in Pro', '3× the monthly credits', 'Priority for long videos'], stripePrice: env('STRIPE_PRICE_STUDIO') },
]
export const packs: Pack[] = [
  { id: 'pack-s', name: '5,000 extra credits', priceLabel: env('PACK_S_LABEL', 'US$ 6'), credits: 5000, stripePrice: env('STRIPE_PRICE_PACK_S') },
  { id: 'pack-l', name: '20,000 extra credits', priceLabel: env('PACK_L_LABEL', 'US$ 22'), credits: 20000, stripePrice: env('STRIPE_PRICE_PACK_L') },
]

export const MICRO = 1_000_000
export const chargeFor = (costUsd: number) => Math.max(0, Math.round(((costUsd * config.markup) / config.creditUsd) * MICRO))
export const creditsFor = (usd: number) => (usd * config.markup) / config.creditUsd

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.status = status
    this.code = code
  }
}
