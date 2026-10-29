// Orbi Cloud on Supabase Edge Functions (see handler.ts for the routes).
import { handler } from './handler.ts'

Deno.serve(handler)
