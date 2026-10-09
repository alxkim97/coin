// Claude's command-line access to Coin, as the HELPER account saved by
// scripts/save-session.js — never the owner's login. Everything here is
// limited by the database to what Settings → Claude access allows:
//   read + suggest  while "Can read transactions and suggest" is on
//   add/edit/delete only while a direct-editing window is open
// Direct changes are logged (coin_delegate_log) and undoable in Settings.
//
// Usage:
//   node scripts/coin-claude.js status
//   node scripts/coin-claude.js list [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--q text]
//   node scripts/coin-claude.js suggest '<json>'          new transaction
//   node scripts/coin-claude.js suggest-edit <id> '<json>' changed fields only
//   node scripts/coin-claude.js suggest-delete <id> ['note']
//   node scripts/coin-claude.js add '<json>'              direct (window only)
//   node scripts/coin-claude.js edit <id> '<json>'        direct (window only)
//   node scripts/coin-claude.js delete <id>               direct (window only)
// JSON fields: type, amount, date, category, subcategory (vendor), notes,
// tags, is_credit_card, is_shopee, source_note (suggestions only).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SESSION_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.coin-session.json')
const SUPA_URL = 'https://jpsisvaprkrcyvwnmasb.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwc2lzdmFwcmtyY3l2d25tYXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM3NDgsImV4cCI6MjA5MzQ3OTc0OH0.Q7kmjiYSayzFJkjH42RoEXhbr9hjI9lXaDmX5Es4D4M'

const TXN_FIELDS = ['type', 'amount', 'date', 'category', 'subcategory', 'notes', 'tags', 'is_credit_card', 'is_shopee']
// same mapping as categories.js — kept inline so this script has no app imports
const BUDGET_TYPES = {
  Rent: 'Fixed Essential', Insurance: 'Fixed Essential', Internet: 'Fixed Essential', 'Bank/Finance': 'Fixed Essential',
  Food: 'Variable Essential', Groceries: 'Variable Essential', Transport: 'Variable Essential', Health: 'Variable Essential', Utilities: 'Variable Essential',
  Investment: 'Investment',
}
const budgetType = (t) => t.type === 'expense' ? (BUDGET_TYPES[t.category] || 'Discretionary') : null

const fail = (msg) => { console.error(msg); process.exit(1) }
const parseJson = (s) => { try { return JSON.parse(s) } catch (e) { fail('Invalid JSON: ' + e.message) } }
const only = (obj, fields) => Object.fromEntries(fields.filter(f => obj[f] !== undefined).map(f => [f, obj[f]]))

async function connect() {
  if (!existsSync(SESSION_PATH)) fail('No helper session — ask the user to run: node scripts/save-session.js')
  const saved = JSON.parse(readFileSync(SESSION_PATH, 'utf8'))
  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
  const { data, error } = await supa.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
  if (error) fail('Helper session expired — ask the user to re-run: node scripts/save-session.js\n' + error.message)
  writeFileSync(SESSION_PATH, JSON.stringify({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, saved_at: new Date().toISOString(), email: data.user.email }, null, 2))
  const { data: grants, error: gErr } = await supa.from('coin_delegates').select('*').eq('delegate_id', data.user.id)
  if (gErr) fail(gErr.message)
  if (!grants.length) fail(`${data.user.email} isn't connected to anyone — the user enters it in Settings → Claude access.`)
  const grant = grants[0]
  return { supa, me: data.user, grant, owner: grant.owner_id, editOpen: !!grant.edit_until && new Date(grant.edit_until) > new Date() }
}

function requireEdit(ctx) {
  if (!ctx.editOpen) fail('Direct editing is off — ask the user to open a window in Settings → Claude access, or use suggest/suggest-edit/suggest-delete.')
}

async function getTxn(ctx, id) {
  const { data, error } = await ctx.supa.from('coin_transactions').select('*').eq('id', id).maybeSingle()
  if (error) fail(error.message)
  if (!data) fail(`No transaction ${id} visible to the helper.`)
  return data
}

const fmt = (t) => `${t.date} ${t.type === 'income' ? '+' : '-'}฿${t.amount} ${t.category}${t.subcategory ? ' / ' + t.subcategory : ''}${t.notes ? ' — ' + t.notes : ''}  [${t.id}]`

const commands = {
  async status(ctx) {
    console.log(`Helper: ${ctx.me.email}`)
    console.log(`Suggest: ${ctx.grant.can_suggest ? 'on' : 'off'}`)
    console.log(`Direct editing: ${ctx.editOpen ? `on until ${new Date(ctx.grant.edit_until).toLocaleString('en-GB')}${ctx.grant.edit_note ? ' — ' + ctx.grant.edit_note : ''}` : 'off'}`)
  },

  async list(ctx, args) {
    const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined }
    const all = []
    for (let start = 0; ; start += 1000) {
      let q = ctx.supa.from('coin_transactions').select('*').eq('user_id', ctx.owner)
        .order('date', { ascending: false }).order('id').range(start, start + 999)
      if (opt('from')) q = q.gte('date', opt('from'))
      if (opt('to')) q = q.lte('date', opt('to'))
      const { data, error } = await q
      if (error) fail(error.message)
      all.push(...data)
      if (data.length < 1000) break
    }
    const needle = opt('q')?.toLowerCase()
    const rows = needle ? all.filter(t => [t.category, t.subcategory, t.notes, ...(t.tags || [])].join(' ').toLowerCase().includes(needle)) : all
    if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2))
    else { rows.forEach(t => console.log(fmt(t))); console.log(`${rows.length} transaction(s)`) }
  },

  async suggest(ctx, [json]) {
    const s = parseJson(json)
    for (const f of ['type', 'amount', 'date', 'category']) if (s[f] == null || s[f] === '') fail(`Missing ${f}`)
    const row = { ...only(s, [...TXN_FIELDS, 'source_note']), budget_type: budgetType(s), user_id: ctx.owner, action: 'add' }
    const { data, error } = await ctx.supa.from('coin_suggestions').insert(row).select('id').single()
    if (error) fail(error.message)
    console.log(`Suggested add: ${fmt({ ...row, id: data.id })}`)
  },

  async 'suggest-edit'(ctx, [id, json]) {
    const target = await getTxn(ctx, id)
    const merged = { ...only(target, TXN_FIELDS), ...only(parseJson(json), TXN_FIELDS) }
    const row = { ...merged, budget_type: budgetType(merged), source_note: parseJson(json).source_note, user_id: ctx.owner, action: 'edit', target_id: id }
    const { error } = await ctx.supa.from('coin_suggestions').insert(row)
    if (error) fail(error.message)
    console.log(`Suggested edit of ${fmt(target)}\n  →  ${fmt({ ...merged, id })}`)
  },

  async 'suggest-delete'(ctx, [id, note]) {
    const target = await getTxn(ctx, id)
    const row = { ...only(target, TXN_FIELDS), budget_type: target.budget_type, source_note: note || null, user_id: ctx.owner, action: 'delete', target_id: id }
    const { error } = await ctx.supa.from('coin_suggestions').insert(row)
    if (error) fail(error.message)
    console.log(`Suggested delete: ${fmt(target)}`)
  },

  async add(ctx, [json]) {
    requireEdit(ctx)
    const t = parseJson(json)
    for (const f of ['type', 'amount', 'date', 'category']) if (t[f] == null || t[f] === '') fail(`Missing ${f}`)
    const row = { ...only(t, TXN_FIELDS), budget_type: budgetType(t), user_id: ctx.owner }
    const { data, error } = await ctx.supa.from('coin_transactions').insert(row).select().single()
    if (error) fail(error.message)
    console.log(`Added: ${fmt(data)}`)
  },

  async edit(ctx, [id, json]) {
    requireEdit(ctx)
    const target = await getTxn(ctx, id)
    const patch = only(parseJson(json), TXN_FIELDS)
    if (patch.category || patch.type) patch.budget_type = budgetType({ ...target, ...patch })
    const { data, error } = await ctx.supa.from('coin_transactions').update(patch).eq('id', id).select().single()
    if (error) fail(error.message)
    console.log(`Edited: ${fmt(target)}\n    →  ${fmt(data)}`)
  },

  async delete(ctx, [id]) {
    requireEdit(ctx)
    const target = await getTxn(ctx, id)
    const { error } = await ctx.supa.from('coin_transactions').delete().eq('id', id)
    if (error) fail(error.message)
    console.log(`Deleted: ${fmt(target)}`)
  },
}

const [cmd, ...args] = process.argv.slice(2)
if (!commands[cmd]) fail('Commands: ' + Object.keys(commands).join(', ') + ' — see the top of this file for usage.')
connect().then(ctx => commands[cmd](ctx, args)).catch(e => fail(e.message || String(e)))
