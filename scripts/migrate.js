// One-time migration: import Ledger's parsed transaction history into Coin's Supabase tables.
//
// Usage:
//   node scripts/migrate.js
//   (prompts for email, then password with hidden input — nothing is echoed
//   or left in shell history)
//
// Reads ../Ledger/manual logs/ledger-import-all.json (1,416 transactions already
// parsed from the Excel Txns sheets) and inserts them into coin_transactions
// for the signed-in user. Safe to re-run only if the table is empty first —
// it does not de-duplicate.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPA_URL = 'https://jpsisvaprkrcyvwnmasb.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwc2lzdmFwcmtyY3l2d25tYXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM3NDgsImV4cCI6MjA5MzQ3OTc0OH0.Q7kmjiYSayzFJkjH42RoEXhbr9hjI9lXaDmX5Es4D4M'

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()) }))
}

function promptHidden(question) {
  return new Promise(resolve => {
    const stdin = process.stdin
    process.stdout.write(question)
    stdin.resume()
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (char) => {
      if (char === '\r' || char === '\n' || char === '') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (char === '') {
        process.exit(1)
      } else if (char === '' || char === '\b') {
        value = value.slice(0, -1)
      } else {
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

const sourcePath = join(__dirname, '..', '..', 'Ledger', 'manual logs', 'ledger-import-all.json')

async function main() {
  const [, , argEmail, argPassword] = process.argv
  const email = argEmail || await prompt('Email: ')
  const password = argPassword || await promptHidden('Password: ')
  if (!email || !password) {
    console.error('Email and password are required.')
    process.exit(1)
  }

  const supa = createClient(SUPA_URL, SUPA_KEY)
  const { data: authData, error: authErr } = await supa.auth.signInWithPassword({ email, password })
  if (authErr) throw authErr
  console.log(`Signed in as ${authData.user.email}`)

  const { count: existing } = await supa.from('coin_transactions').select('*', { count: 'exact', head: true })
  if (existing > 0) {
    console.error(`coin_transactions already has ${existing} rows. Aborting to avoid duplicates — clear the table first if you want to re-import.`)
    process.exit(1)
  }

  const raw = JSON.parse(readFileSync(sourcePath, 'utf8'))
  console.log(`Loaded ${raw.length} transactions from ${sourcePath}`)

  const rows = raw.map(t => ({
    date: t.date,
    type: t.type,
    amount: t.amount,
    category: t.category,
    subcategory: t.subcategory || t.vendor || null,
    notes: t.notes || null,
    budget_type: t.budgetType || null,
  }))

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supa.from('coin_transactions').insert(chunk)
    if (error) throw error
    inserted += chunk.length
    console.log(`Inserted ${inserted}/${rows.length}`)
  }

  console.log('Migration complete.')
}

main().catch(e => {
  console.error('Migration failed:', e.message || e)
  process.exit(1)
})
