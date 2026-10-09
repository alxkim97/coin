import { fetchDelegates, addDelegate, updateDelegate, removeDelegate, fetchDelegateLog, markDelegateLogUndone, addTransaction, updateTransaction, deleteTransaction } from './supabase.js'
import { escapeHtml, formatMoney, formatDateDMY, toast, confirmDialog, localISO } from './helpers.js'

// Settings → Claude access (phone and desktop share this). Claude works
// through its own helper Coin account; the database policies (see
// SUPABASE-SETUP.md 2026-10-10) enforce what this card switches on:
//   Suggest        — read transactions, propose adds/edits/deletes
//   Direct editing — write transactions until edit_until, then refused
// Every direct change lands in coin_delegate_log via a trigger, listed here
// with Undo.
const FIELDS = ['type', 'amount', 'date', 'category', 'subcategory', 'notes', 'budget_type', 'is_credit_card', 'is_shopee', 'tags', 'receipt_path']
const pick = row => Object.fromEntries(FIELDS.filter(f => row && f in row).map(f => [f, row[f]]))

export function isEditWindowOpen(d) {
  return !!d?.edit_until && new Date(d.edit_until) > new Date()
}

export function formatUntil(iso) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${formatDateDMY(localISO(d))} ${time}`
}

function describe(entry) {
  const row = entry.after || entry.before || {}
  const what = `${escapeHtml(row.category || '')}${row.subcategory ? ' · ' + escapeHtml(row.subcategory) : ''} ${formatMoney(row.amount)}`
  const verb = entry.action === 'insert' ? 'Added' : entry.action === 'update' ? 'Edited' : 'Deleted'
  return `${verb} ${what}${row.date ? ` <span class="ca-dim">(${formatDateDMY(row.date)})</span>` : ''}`
}

async function undoEntry(entry) {
  if (entry.action === 'insert') await deleteTransaction(entry.txn_id)
  else if (entry.action === 'update') await updateTransaction(entry.txn_id, pick(entry.before))
  else await addTransaction(pick(entry.before))
  await markDelegateLogUndone(entry.id)
}

export async function renderClaudeAccess(el, { onChanged }) {
  el.innerHTML = '<div class="ca-dim">Loading…</div>'
  let delegates, log
  try {
    ;[delegates, log] = await Promise.all([fetchDelegates(), fetchDelegateLog(30)])
  } catch {
    el.innerHTML = `<div class="ca-dim">Not set up yet — run the "Claude access" SQL from SUPABASE-SETUP.md in Supabase first.</div>`
    return
  }
  const rerender = () => renderClaudeAccess(el, { onChanged })
  const d = delegates[0]

  if (!d) {
    el.innerHTML = `
      <div class="ca-text">Let Claude help log and fix transactions through its <strong>own</strong> Coin account — never your login. You choose whether it can only suggest (you approve each one) or edit directly for a set time.</div>
      <ol class="ca-steps">
        <li>Sign out, tap <em>Create one</em>, and make a helper account — e.g. <span class="mono">you+claude@gmail.com</span>.</li>
        <li>Sign back in as yourself and enter that email below.</li>
        <li>On your PC, run <span class="mono">node scripts/save-session.js</span> yourself and sign in as the helper.</li>
      </ol>
      <div class="ca-row"><input type="email" id="caEmail" placeholder="helper account email" /><button class="btn secondary ca-btn" id="caConnect">Connect</button></div>
    `
    el.querySelector('#caConnect').onclick = async (e) => {
      const email = el.querySelector('#caEmail').value.trim()
      if (!email.includes('@')) { toast('Enter the helper account email'); return }
      e.currentTarget.disabled = true
      try { await addDelegate(email); toast('Helper connected — it can suggest now'); await onChanged?.(); if (el.isConnected) rerender() } catch (err) { toast(err.message || 'Failed to connect'); e.currentTarget.disabled = false }
    }
    return
  }

  const open = isEditWindowOpen(d)
  el.innerHTML = `
    <div class="ca-head"><div><div class="ca-label">Helper account</div><div class="ca-strong">${escapeHtml(d.delegate_email)}</div></div>
      <button class="btn danger ca-btn" id="caRemove">Disconnect</button></div>

    <label class="checkbox-row ca-check"><input type="checkbox" id="caSuggest" ${d.can_suggest ? 'checked' : ''} />
      <span>Can read transactions and suggest changes <span class="ca-dim">— nothing changes until you Accept on the Dashboard</span></span></label>

    <div class="ca-label" style="margin-top:14px">Direct editing</div>
    ${open
      ? `<div class="ca-status on">On until <strong>${formatUntil(d.edit_until)}</strong>${d.edit_note ? ` — ${escapeHtml(d.edit_note)}` : ''}</div>
         <div class="ca-row"><button class="btn secondary ca-btn" id="caStop">Stop now</button></div>`
      : `<div class="ca-status">Off — Claude can only suggest.</div>
         <input type="text" id="caNote" placeholder="What for? e.g. September KBank statement (optional)" />
         <div class="ca-row">
           <button class="btn secondary ca-btn" data-window="1h">1 hour</button>
           <button class="btn secondary ca-btn" data-window="today">Rest of today</button>
           <button class="btn secondary ca-btn" data-window="24h">24 hours</button>
         </div>`}

    <div class="ca-label" style="margin-top:16px">Claude activity</div>
    ${log.length ? `<div class="ca-log">${log.map(entry => `
      <div class="ca-log-row">
        <div class="ca-log-main"><div>${describe(entry)}</div><div class="ca-dim">${new Date(entry.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
        ${entry.undone_at ? '<span class="ca-dim">Undone</span>' : `<button class="btn secondary ca-btn ca-undo" data-id="${entry.id}">Undo</button>`}
      </div>`).join('')}</div>` : '<div class="ca-dim">No direct changes yet.</div>'}
  `

  el.querySelector('#caRemove').onclick = async () => {
    if (!(await confirmDialog(`Disconnect ${d.delegate_email}? It loses all access immediately. Its activity log stays here.`, 'Disconnect', true))) return
    try { await removeDelegate(d.delegate_id); toast('Helper disconnected'); await onChanged?.(); if (el.isConnected) rerender() } catch (err) { toast(err.message || 'Failed') }
  }
  el.querySelector('#caSuggest').onchange = async (e) => {
    try { await updateDelegate(d.delegate_id, { can_suggest: e.target.checked }); toast(e.target.checked ? 'Suggestions on' : 'Suggestions off'); await onChanged?.() } catch (err) { toast(err.message || 'Failed'); rerender() }
  }
  el.querySelector('#caStop')?.addEventListener('click', async () => {
    try { await updateDelegate(d.delegate_id, { edit_until: null, edit_note: null }); toast('Direct editing stopped'); await onChanged?.(); if (el.isConnected) rerender() } catch (err) { toast(err.message || 'Failed') }
  })
  el.querySelectorAll('[data-window]').forEach(btn => {
    btn.onclick = async () => {
      const now = new Date()
      const until = btn.dataset.window === '1h' ? new Date(now.getTime() + 60 * 60 * 1000)
        : btn.dataset.window === '24h' ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
      const note = el.querySelector('#caNote')?.value.trim() || null
      if (!(await confirmDialog(`Let Claude add, edit and delete transactions until ${formatUntil(until.toISOString())}? Every change is logged here with Undo.`, 'Allow'))) return
      try { await updateDelegate(d.delegate_id, { edit_until: until.toISOString(), edit_note: note }); toast('Direct editing on'); await onChanged?.(); if (el.isConnected) rerender() } catch (err) { toast(err.message || 'Failed') }
    }
  })
  el.querySelectorAll('.ca-undo').forEach(btn => {
    btn.onclick = async () => {
      const entry = log.find(x => x.id === btn.dataset.id)
      btn.disabled = true
      try { await undoEntry(entry); toast('Undone'); await onChanged?.(); if (el.isConnected) rerender() } catch (err) { btn.disabled = false; toast(err.message || 'Undo failed — the transaction may have changed since') }
    }
  })
}
