import { createClient } from '@supabase/supabase-js'

const SUPA_URL = 'https://jpsisvaprkrcyvwnmasb.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwc2lzdmFwcmtyY3l2d25tYXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM3NDgsImV4cCI6MjA5MzQ3OTc0OH0.Q7kmjiYSayzFJkjH42RoEXhbr9hjI9lXaDmX5Es4D4M'

export const supa = createClient(SUPA_URL, SUPA_KEY)

export async function getSession() {
  const { data } = await supa.auth.getSession()
  return data.session
}

export function onAuthChange(cb) {
  supa.auth.onAuthStateChange((_event, session) => cb(session))
}

export async function signIn(email, password) {
  const { data, error } = await supa.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUp(email, password) {
  const { data, error } = await supa.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supa.auth.signOut()
}

export async function updateEmail(newEmail) {
  const { data, error } = await supa.auth.updateUser({ email: newEmail })
  if (error) throw error
  return data
}

export async function updateDisplayName(name) {
  const { data, error } = await supa.auth.updateUser({ data: { display_name: name } })
  if (error) throw error
  return data
}

/* ── Transactions ── */

// Supabase caps every request at 1000 rows by default, so a single select
// silently dropped the oldest transactions once there were more than that —
// including from backups/CSV exports. Page through until a short page comes
// back. id is the final tiebreaker so pages never overlap or skip rows.
const PAGE_SIZE = 1000
export async function fetchTransactions({ from, to } = {}) {
  const all = []
  for (let start = 0; ; start += PAGE_SIZE) {
    let q = supa.from('coin_transactions').select('*')
      .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true })
    if (from) q = q.gte('date', from)
    if (to) q = q.lte('date', to)
    const { data, error } = await q.range(start, start + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE_SIZE) return all
  }
}

export async function addTransaction(txn) {
  const { data, error } = await supa.from('coin_transactions').insert(txn).select().single()
  if (error) throw error
  return data
}

export async function updateTransaction(id, patch) {
  const { data, error } = await supa.from('coin_transactions').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTransaction(id) {
  const { error } = await supa.from('coin_transactions').delete().eq('id', id)
  if (error) throw error
}

// Used by Settings' backup restore. Strips id/user_id/created_at so
// Supabase assigns fresh ones and the column default fills user_id — these
// always ADD rows, they never replace or dedupe against what's already
// there (restoring the same backup twice doubles it, by design/documented).
export async function bulkInsertTransactions(rows) {
  const clean = rows.map(({ id, user_id, created_at, ...rest }) => rest)
  if (!clean.length) return []
  const { data, error } = await supa.from('coin_transactions').insert(clean).select()
  if (error) throw error
  return data
}

/* ── Budgets ── */

export async function fetchBudgets() {
  const { data, error } = await supa.from('coin_budgets').select('*')
  if (error) throw error
  return data
}

export async function upsertBudget(category, monthly_limit, budget_type) {
  const { data, error } = await supa
    .from('coin_budgets')
    .upsert({ category, monthly_limit, budget_type, user_id: (await supa.auth.getUser()).data.user.id }, { onConflict: 'user_id,category' })
    .select()
    .single()
  if (error) throw error
  return data
}

/* ── Repeat purchases ── */

export async function fetchRecurring() {
  const { data, error } = await supa.from('coin_recurring').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addRecurring(item) {
  const { data, error } = await supa.from('coin_recurring').insert(item).select().single()
  if (error) throw error
  return data
}

export async function updateRecurring(id, patch) {
  const { data, error } = await supa.from('coin_recurring').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Moves next_due forward only if it still holds the value this device saw.
// Returns false when another device (phone + desktop both opening on a due
// date) already moved it — that device is posting the period, so skip it.
export async function claimRecurringPeriod(id, expectedNextDue, newNextDue) {
  const { data, error } = await supa.from('coin_recurring')
    .update({ next_due: newNextDue }).eq('id', id).eq('next_due', expectedNextDue).select('id')
  if (error) throw error
  return data.length > 0
}

export async function deleteRecurring(id) {
  const { error } = await supa.from('coin_recurring').delete().eq('id', id)
  if (error) throw error
}

// See bulkInsertTransactions above — same restore-only, additive-only contract.
export async function bulkInsertRecurring(rows) {
  const clean = rows.map(({ id, user_id, created_at, ...rest }) => rest)
  if (!clean.length) return []
  const { data, error } = await supa.from('coin_recurring').insert(clean).select()
  if (error) throw error
  return data
}

/* ── Suggested transactions (e.g. from Claude) — never auto-committed;
   Accept posts a real transaction through this session, Decline just
   removes the suggestion. ── */
export async function fetchSuggestions() {
  const { data, error } = await supa.from('coin_suggestions').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function deleteSuggestion(id) {
  const { error } = await supa.from('coin_suggestions').delete().eq('id', id)
  if (error) throw error
}

/* ── Claude access (helper accounts) — see SUPABASE-SETUP.md 2026-10-10.
   The helper is a separate Coin account; what it may do is enforced by the
   database policies, these just manage the grant and read its log. ── */
export async function fetchDelegates() {
  const { data: { user } } = await supa.auth.getUser()
  // owner_id filter: a helper account would otherwise also see grants made TO it
  const { data, error } = await supa.from('coin_delegates').select('*').eq('owner_id', user.id).order('created_at')
  if (error) throw error
  return data
}

export async function addDelegate(email) {
  const { error } = await supa.rpc('coin_add_delegate', { helper_email: email })
  if (error) throw error
}

export async function updateDelegate(delegateId, patch) {
  const { data: { user } } = await supa.auth.getUser()
  const { error } = await supa.from('coin_delegates').update(patch).eq('owner_id', user.id).eq('delegate_id', delegateId)
  if (error) throw error
}

export async function removeDelegate(delegateId) {
  const { data: { user } } = await supa.auth.getUser()
  const { error } = await supa.from('coin_delegates').delete().eq('owner_id', user.id).eq('delegate_id', delegateId)
  if (error) throw error
}

export async function fetchDelegateLog(limit = 50) {
  const { data, error } = await supa.from('coin_delegate_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data
}

export async function markDelegateLogUndone(id) {
  const { error } = await supa.from('coin_delegate_log').update({ undone_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/* ── Net worth check-ins ── */

export async function fetchNetWorth() {
  const { data, error } = await supa.from('coin_networth').select('*, items:coin_networth_items(*)').order('date', { ascending: true })
  if (!error) return data
  // coin_networth_items may not exist yet on an install that only ran the
  // first of the two migration steps — PostgREST fails the whole embedded
  // join in that case (not per-row), which used to discard real,
  // already-logged net-worth history along with it. Fall back to the
  // checkin rows alone so cash/invested/date still show.
  const { data: checkinsOnly, error: fallbackError } = await supa.from('coin_networth').select('*').order('date', { ascending: true })
  if (fallbackError) throw error // the original error is more informative than the fallback's
  return checkinsOnly.map(c => ({ ...c, items: null }))
}

// items: [{name, category: 'cash'|'invested', value}] — cash/invested on the
// checkin row are computed rollups of the items, kept so the Analysis chart
// and Projection (which read n.cash/n.invested directly) don't need to change.
export async function addNetWorth({ date, items }) {
  const cash = items.filter(i => i.category === 'cash').reduce((s, i) => s + Number(i.value), 0)
  const invested = items.filter(i => i.category === 'invested').reduce((s, i) => s + Number(i.value), 0)
  const { data: checkin, error } = await supa.from('coin_networth').insert({ date, cash, invested }).select().single()
  if (error) throw error
  const rows = items.map(i => ({ checkin_id: checkin.id, name: i.name, category: i.category, value: Number(i.value) }))
  const { data: insertedItems, error: itemsError } = await supa.from('coin_networth_items').insert(rows).select()
  if (itemsError) {
    // roll back the checkin row we just created — otherwise a failed items
    // insert leaves an orphaned, item-less checkin behind permanently
    await supa.from('coin_networth').delete().eq('id', checkin.id)
    throw itemsError
  }
  return { ...checkin, items: insertedItems }
}

export async function deleteNetWorth(id) {
  const { error } = await supa.from('coin_networth').delete().eq('id', id)
  if (error) throw error
}

/* ── Push subscriptions (budget alerts) ── */

export async function savePushSubscription(sub) {
  const { endpoint, keys } = sub.toJSON()
  const { error } = await supa
    .from('coin_push_subscriptions')
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth, user_id: (await supa.auth.getUser()).data.user.id }, { onConflict: 'endpoint' })
  if (error) throw error
}

/* ── Savings goals ── */

export async function fetchGoals() {
  const { data, error } = await supa.from('coin_goals').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addGoal(goal) {
  const { data, error } = await supa.from('coin_goals').insert(goal).select().single()
  if (error) throw error
  return data
}

export async function updateGoal(id, patch) {
  const { data, error } = await supa.from('coin_goals').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteGoal(id) {
  const { error } = await supa.from('coin_goals').delete().eq('id', id)
  if (error) throw error
}

// See bulkInsertTransactions above — same restore-only, additive-only contract.
export async function bulkInsertGoals(rows) {
  const clean = rows.map(({ id, user_id, created_at, ...rest }) => rest)
  if (!clean.length) return []
  const { data, error } = await supa.from('coin_goals').insert(clean).select()
  if (error) throw error
  return data
}

/* ── Receipt photos ── */

// Path convention <user_id>/<txnId>-<timestamp>.<ext> — the storage RLS
// policy scopes access by the first path segment matching auth.uid(), same
// ownership model as every table's RLS above, just for Storage objects.
export async function uploadReceipt(txnId, file) {
  const { data: { user } } = await supa.auth.getUser()
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${user.id}/${txnId}-${Date.now()}.${ext}`
  const { error: uploadError } = await supa.storage.from('receipts').upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError
  await updateTransaction(txnId, { receipt_path: path })
  return path
}

// Private bucket — no public URLs for financial documents, so every view
// needs a fresh short-lived signed URL instead.
export async function getReceiptUrl(path) {
  const { data, error } = await supa.storage.from('receipts').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function deleteReceipt(path) {
  const { error } = await supa.storage.from('receipts').remove([path])
  if (error) throw error
}

// Swipe-delete and desktop History delete keep the receipt file so Undo can
// bring the transaction back with its photo — this sweeps up files no
// transaction points at anymore. Only files over a day old, so an upload
// whose receipt_path update is still landing (or one on another device) is
// never touched. knownPaths must be the complete transaction list.
export async function sweepOrphanReceipts(knownPaths) {
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return 0
  const keep = new Set(knownPaths)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const orphans = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supa.storage.from('receipts').list(user.id, { limit: 1000, offset })
    if (error) throw error
    for (const f of data) {
      const path = `${user.id}/${f.name}`
      if (!f.id || keep.has(path)) continue // no id = a folder placeholder, not a file
      if (new Date(f.created_at).getTime() < cutoff) orphans.push(path)
    }
    if (data.length < 1000) break
  }
  if (orphans.length) {
    const { error } = await supa.storage.from('receipts').remove(orphans)
    if (error) throw error
  }
  return orphans.length
}

// Restore-only, additive-only (see bulkInsertTransactions). Reuses
// addNetWorth's own checkin+items+rollback logic for the common case;
// falls back to inserting the checkin row directly for a legacy backup
// entry that has no items (pre-multi-asset export), so its cash/invested
// totals aren't silently dropped by addNetWorth's items-derive-the-totals logic.
export async function bulkRestoreNetWorth(checkins) {
  for (const c of checkins) {
    if (c.items && c.items.length) {
      await addNetWorth({ date: c.date, items: c.items.map(({ name, category, value }) => ({ name, category, value })) })
    } else {
      const { error } = await supa.from('coin_networth').insert({ date: c.date, cash: c.cash, invested: c.invested })
      if (error) throw error
    }
  }
}

/* ── Projection events (desktop Projection page) ── */

// One-off or repeating money events you add yourself (a bonus, a renovation,
// a new rent income) layered on top of the run-rate projection.
// kind: 'income' | 'expense'; frequency: 'once' | 'monthly' | 'yearly';
// start_month / end_month are the 1st of a month (end_month null = open-ended).
export async function fetchProjectionEvents() {
  const { data, error } = await supa.from('coin_projection_events').select('*').order('start_month', { ascending: true })
  if (error) throw error
  return data
}

export async function addProjectionEvent(ev) {
  const { data, error } = await supa.from('coin_projection_events').insert(ev).select().single()
  if (error) throw error
  return data
}

export async function updateProjectionEvent(id, patch) {
  const { data, error } = await supa.from('coin_projection_events').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteProjectionEvent(id) {
  const { error } = await supa.from('coin_projection_events').delete().eq('id', id)
  if (error) throw error
}

/* ── Net worth accounts (Analysis → edit/delete an account) ── */

// An "account" is just every coin_networth_items row sharing a name, across
// all check-ins — so renaming/re-typing or deleting one touches all of them.
// Matching is case-insensitive, same as latestAccountValues' grouping.
async function accountItemRows(name) {
  const key = name.trim().toLowerCase()
  const { data, error } = await supa.from('coin_networth_items').select('id, name, checkin_id').ilike('name', name.trim())
  if (error) throw error
  return data.filter(r => r.name.trim().toLowerCase() === key) // ilike treats _ and % as wildcards — keep exact matches only
}

// Keeps each check-in row's cash/invested rollup in step with its items. A
// check-in left with no items at all is deleted: netWorthTimeline falls back
// to the rollup columns for item-less (legacy) check-ins, so leaving it would
// keep counting the account that was just removed.
async function resyncCheckins(checkinIds) {
  for (const id of new Set(checkinIds)) {
    const { data: items, error } = await supa.from('coin_networth_items').select('category, value').eq('checkin_id', id)
    if (error) throw error
    if (!items.length) {
      const { error: delErr } = await supa.from('coin_networth').delete().eq('id', id)
      if (delErr) throw delErr
      continue
    }
    const cash = items.filter(i => i.category === 'cash').reduce((s, i) => s + Number(i.value), 0)
    const invested = items.filter(i => i.category === 'invested').reduce((s, i) => s + Number(i.value), 0)
    const { error: upErr } = await supa.from('coin_networth').update({ cash, invested }).eq('id', id)
    if (upErr) throw upErr
  }
}

export async function renameNetWorthAccount(oldName, { name, category }) {
  const rows = await accountItemRows(oldName)
  if (!rows.length) return
  const patch = {}
  if (name) patch.name = name.trim()
  if (category) patch.category = category
  const { error } = await supa.from('coin_networth_items').update(patch).in('id', rows.map(r => r.id))
  if (error) throw error
  if (category) await resyncCheckins(rows.map(r => r.checkin_id))
}

export async function deleteNetWorthAccount(name) {
  const rows = await accountItemRows(name)
  if (!rows.length) return
  const { error } = await supa.from('coin_networth_items').delete().in('id', rows.map(r => r.id))
  if (error) throw error
  await resyncCheckins(rows.map(r => r.checkin_id))
}
