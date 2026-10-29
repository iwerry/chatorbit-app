// Adds credits to an account without going through Stripe (for tests, support and launch).
// Usage: npm run grant -- you@example.com 5000 [plan|extra]
import { MICRO } from '../src/config.ts'
import { tx } from '../src/db.ts'
import { credit, getUser, publicUser, userByEmail } from '../src/accounts.ts'

const [email, amount, bucket = 'extra'] = process.argv.slice(2)
if (!email || !amount) {
  console.log('Usage: npm run grant -- <email> <credits> [plan|extra]')
  process.exit(1)
}
const u = userByEmail(email)
if (!u) {
  console.error(`No account with ${email}. Create it in the Orbi app first.`)
  process.exit(1)
}
tx(() => credit(u.id, bucket === 'plan' ? 'plan' : 'extra', Math.round(Number(amount) * MICRO), 'grant', 'Granted from the command line'))
console.log(publicUser(getUser(u.id)!))
