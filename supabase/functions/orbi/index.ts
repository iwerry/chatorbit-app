// Orbi Cloud on Supabase Edge Functions (see handler.ts for the routes).
import { handler } from './handler.ts'

// Diagnosis without secrets: the names of the Orbi settings this function can see (never their values).
const names = Object.keys(Deno.env.toObject()).filter((k) => /OPENROUTER|ADMIN|STRIPE|MARKUP|CREDIT/i.test(k))
console.log(`[orbi] settings found: ${names.length ? names.sort().join(', ') : 'none'}`)

Deno.serve(handler)
