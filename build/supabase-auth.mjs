// Applies Orbi's Auth settings to the Supabase project through the Management API:
// Site URL plus the signup/recovery e-mails with the 6-digit code the app expects.
//   $env:SUPABASE_ACCESS_TOKEN = "<personal token>"; node build/supabase-auth.mjs          (shows the changes)
//   $env:SUPABASE_ACCESS_TOKEN = "<personal token>"; node build/supabase-auth.mjs --apply  (applies them)
// The token stays in the terminal environment; never commit it or paste it in a chat.
import { readFileSync } from 'node:fs'

const REF = 'jtdkbtszyrqogmvznrig'
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens) in this terminal first.')
  process.exit(1)
}
const template = (name) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), 'utf8')
const wanted = {
  site_url: `https://${REF}.supabase.co/functions/v1/orbi/auth/done`,
  mailer_subjects_confirmation: 'Seu código do Orbi',
  mailer_templates_confirmation_content: template('confirmation'),
  mailer_subjects_recovery: 'Código para trocar a senha do Orbi',
  mailer_templates_recovery_content: template('recovery'),
}

const api = (method, body) =>
  fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${method} config/auth failed (${r.status}): ${(await r.text()).slice(0, 300)}`)
    return r.json()
  })

const current = await api('GET')
const changes = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => current[k] !== v))
for (const key of Object.keys(wanted)) {
  const before = String(current[key] ?? '')
  const shown = key.endsWith('_content') ? `${before.length} chars, code: ${before.includes('{{ .Token }}') ? 'yes' : 'no'}` : before
  console.log(`${key in changes ? 'change' : 'ok    '} ${key}: ${shown}`)
}
if (!Object.keys(changes).length) console.log('Nothing to change.')
else if (!process.argv.includes('--apply')) console.log('\nRun again with --apply to save these changes.')
else {
  await api('PATCH', changes)
  console.log(`\nSaved ${Object.keys(changes).length} setting(s).`)
}
