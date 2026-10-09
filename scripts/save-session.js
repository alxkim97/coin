// Run this yourself, in your own terminal — not through Claude. Sign in as
// the HELPER account (Settings → Claude access), never your own: it saves
// that account's session (refresh token) to .coin-session.json so Claude can
// use scripts/coin-claude.js without ever seeing a password. What the helper
// may do is enforced by the database, per the switches in Settings.
//
// Usage:
//   node scripts/save-session.js
//   (prompts for email, then password with hidden input — nothing is echoed
//   or left in shell history)
//
// Refuses to save an account that owns transactions (i.e. your main one).
// .coin-session.json is gitignored. Delete it, or Disconnect the helper in
// Settings, to revoke access.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = join(__dirname, '..', '.coin-session.json')

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
      if (char === '\r' || char === '\n' || char === '\u0004') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (char === '\u0003') {
        process.exit(1)
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1)
      } else {
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const email = await prompt('Email: ')
  const password = await promptHidden('Password: ')
  if (!email || !password) {
    console.error('Email and password are required.')
    process.exit(1)
  }

  const supa = createClient(SUPA_URL, SUPA_KEY)
  const { data, error } = await supa.auth.signInWithPassword({ email, password })
  if (error) throw error

  // safety: the helper account owns no transactions of its own
  const { data: own, error: ownErr } = await supa.from('coin_transactions').select('id').eq('user_id', data.user.id).limit(1)
  if (ownErr) throw ownErr
  if (own.length) {
    await supa.auth.signOut()
    console.error(`${data.user.email} has its own transactions — that looks like your main account. Not saved.`)
    console.error('Sign in with the separate helper account instead (Settings → Claude access).')
    process.exit(1)
  }
  const { data: grants } = await supa.from('coin_delegates').select('owner_id').eq('delegate_id', data.user.id)
  if (!grants?.length) console.warn('Note: this account is not connected yet — enter its email in Settings → Claude access.')

  writeFileSync(SESSION_PATH, JSON.stringify({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    saved_at: new Date().toISOString(),
    email: data.user.email,
  }, null, 2))

  console.log(`Signed in as ${data.user.email}. Session saved to ${SESSION_PATH}`)
  console.log('Claude can now act as this helper account, limited to what Settings → Claude access allows.')
}

main().catch(e => {
  console.error('Sign-in failed:', e.message || e)
  process.exit(1)
})
