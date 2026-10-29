// Starts Orbi Cloud on this machine. Run with: npm start
import { config } from './config.ts'
import { server } from './server.ts'
import { paymentsEnabled } from './stripe.ts'

server.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Orbi Cloud running on ${config.publicUrl}`)
  if (!config.openrouterKey) console.warn('! OPENROUTER_API_KEY is empty: AI calls will fail until you set it in .env')
  if (!paymentsEnabled()) console.warn('! Stripe is not set: payments are off (use `npm run grant -- email credits` to add credits)')
})
