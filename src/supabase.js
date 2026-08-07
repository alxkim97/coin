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

export async function fetchTransactions({ from, to } = {}) {
  let q = supa.from('coin_transactions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })
  if (from) q = q.gte('date', from)
  if (to) q = q.lte('date', to)
  const { data, error } = await q
  if (error) throw error
  return data
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

export async function deleteRecurring(id) {
  const { error } = await supa.from('coin_recurring').delete().eq('id', id)
  if (error) throw error
}
