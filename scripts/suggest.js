// Claude uses this to write a row into coin_suggestions — never directly
// into coin_transactions. The user reviews every suggestion in-app (Accept
// turns it into a real transaction through their own session; Decline just
// dismisses it) — this script can never commit anything to the real ledger
// on its own.
//
// Usage: node scripts/suggest.js '<json>'
//   node scripts/suggest.js '{"type":"expense","amount":65,"category":"Food","date":"2026-08-28","notes":"รุ่งเรือ purchase","source_note":"KBank statement reconciliation, 28/08"}'
//
// Requires .coin-session.json (created by save-session.js, run by the user
// themselves — this script never prompts for or sees a password).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = join(__dirname, '..', '.coin-session.json')

const SUPA_URL = 'https://jpsisvaprkrcyvwnmasb.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwc2lzdmFwcmtyY3l2d25tYXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM3NDgsImV4cCI6MjA5MzQ3OTc0OH0.Q7kmjiYSayzFJkjH42RoEXhbr9hjI9lXaDmX5Es4D4M'

const REQUIRED = ['type', 'amount', 'category', 'date']
const ALLOWED_FIELDS = ['type', 'amount', 'category', 'subcategory', 'notes', 'date', 'is_credit_card', 'is_shopee', 'budget_type', 'source_note']

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: node scripts/suggest.js \'<json>\'')
    process.exit(1)
  }
  if (!existsSync(SESSION_PATH)) {
    console.error(`No saved session at ${SESSION_PATH} — ask the user to run: node scripts/save-session.js`)
    process.exit(1)
  }

  let suggestion
  try {
    suggestion = JSON.parse(arg)
  } catch (e) {
    console.error('Invalid JSON:', e.message)
    process.exit(1)
  }
  for (const field of REQUIRED) {
    if (suggestion[field] === undefined || suggestion[field] === null || suggestion[field] === '') {
      console.error(`Missing required field: ${field}`)
      process.exit(1)
    }
  }
  if (!['income', 'expense'].includes(suggestion.type)) {
    console.error('type must be "income" or "expense"')
    process.exit(1)
  }
  const row = {}
  for (const field of ALLOWED_FIELDS) {
    if (suggestion[field] !== undefined) row[field] = suggestion[field]
  }

  const session = JSON.parse(readFileSync(SESSION_PATH, 'utf8'))
  const supa = createClient(SUPA_URL, SUPA_KEY)
  const { data: refreshed, error: refreshErr } = await supa.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (refreshErr) {
    console.error('Session invalid or expired — ask the user to re-run: node scripts/save-session.js')
    console.error(refreshErr.message)
    process.exit(1)
  }
  // persist the refreshed tokens so the session keeps working next time too
  writeFileSync(SESSION_PATH, JSON.stringify({
    access_token: refreshed.session.access_token,
    refresh_token: refreshed.session.refresh_token,
    saved_at: new Date().toISOString(),
    email: refreshed.user.email,
  }, null, 2))

  const { data, error } = await supa.from('coin_suggestions').insert(row).select().single()
  if (error) throw error

  console.log(`Suggested: ${row.type} ฿${row.amount} — ${row.category}${row.subcategory ? ' / ' + row.subcategory : ''} on ${row.date}`)
  console.log(`id: ${data.id}`)
}

main().catch(e => {
  console.error('Failed to write suggestion:', e.message || e)
  process.exit(1)
})
