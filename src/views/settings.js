import { toast, downloadFile, txnsToCsv, todayISO, confirmDialog, escapeHtml } from '../helpers.js'
import { signOut, updateEmail, updateDisplayName, bulkInsertTransactions, bulkInsertRecurring, bulkRestoreNetWorth, bulkInsertGoals, upsertBudget } from '../supabase.js'
import { ACCENTS, getMode, setMode, getAccent, setAccent } from '../theme.js'

// Settings is app-function only (appearance, data, account) — Repeat
// Purchases/Net Worth/Goals/Year in Review each live where they're actually
// used (Add page, Dashboard widgets, Analysis), not tucked in here.
export function renderSettings(container, opts) {
  const { txns, budgets, recurring, networth, goals, session, onSignedOut, onSessionChanged, onDataRestored } = opts

  const displayName = session?.user?.user_metadata?.display_name || ''
  const mode = getMode()
  const accent = getAccent()

  container.innerHTML = `
    <div class="top-bar"><h1>Settings</h1></div>

    <h2>Appearance</h2>
    <div class="card" style="margin-bottom:16px">
      <label style="margin-top:0">Mode</label>
      <div class="toggle-row" id="modeToggle">
        <button data-mode="system" class="${mode === 'system' ? 'active' : ''}">System</button>
        <button data-mode="light" class="${mode === 'light' ? 'active' : ''}">Light</button>
        <button data-mode="dark" class="${mode === 'dark' ? 'active' : ''}">Dark</button>
      </div>
      <label>Accent color</label>
      <div class="accent-swatches" id="accentSwatches">
        ${ACCENTS.map(a => `<button class="accent-swatch ${a.id === accent ? 'active' : ''}" data-accent="${a.id}" style="background:${a.swatch}" title="${a.label}" aria-label="${a.label}"></button>`).join('')}
      </div>
    </div>

    <h2>Data</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Export all ${txns.length} transaction${txns.length === 1 ? '' : 's'} as a spreadsheet, or a full backup of everything in your account.</div>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" id="exportCsv">Export CSV</button>
        <button class="btn secondary" id="exportJson">Export Backup</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Restore transactions, budgets, repeat purchases, and net worth check-ins from a backup file. This <strong>adds</strong> records — it never replaces or removes anything already in your account, so restoring the same file twice will duplicate everything in it.</div>
      <input type="file" accept="application/json" id="restoreFileInput" style="display:none" />
      <button class="btn secondary" id="restoreBackupBtn">Restore from Backup…</button>
    </div>

    ${window.electronAPI?.isElectron ? `
      <h2>Desktop App</h2>
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Version <span id="appVersion">…</span> · Alex Kim — updates download in the background and prompt you to restart when ready.</div>
        <button class="btn secondary" id="checkUpdatesBtn">Check for Updates</button>
      </div>
    ` : ''}

    <h2>Account</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2)">Signed in as</div>
      <div style="font-weight:600;margin-top:2px">${escapeHtml(displayName) || session?.user?.email || ''}</div>
      ${displayName ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${escapeHtml(session?.user?.email || '')}</div>` : ''}
      <label style="margin-top:14px">Display Name</label>
      <input id="displayNameInput" type="text" placeholder="e.g. Alex" value="${escapeHtml(displayName)}" />
      <button class="btn secondary" id="saveDisplayNameBtn" style="margin-top:10px">Save</button>
      <label style="margin-top:16px">Change Email</label>
      <input id="newEmailInput" type="email" placeholder="new-email@example.com" />
      <button class="btn secondary" id="changeEmailBtn" style="margin-top:10px">Send Confirmation Link</button>
      <div style="font-size:12px;color:var(--text2);margin-top:8px">You'll get a confirmation link at the new address — nothing changes until you click it, and you keep signing in with your current email until then.</div>
    </div>
    <div class="card">
      <button class="btn danger" id="signOutBtn">Sign Out</button>
    </div>
  `

  container.querySelector('#modeToggle').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { setMode(btn.dataset.mode); renderSettings(container, opts) }
  })
  container.querySelector('#accentSwatches').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { setAccent(btn.dataset.accent); renderSettings(container, opts) }
  })

  container.querySelector('#exportCsv').onclick = () => {
    downloadFile(`coin-transactions-${todayISO()}.csv`, txnsToCsv(txns), 'text/csv')
  }
  container.querySelector('#exportJson').onclick = () => {
    const backup = { version: 1, exportedAt: new Date().toISOString(), txns, budgets, recurring, networth, goals }
    downloadFile(`coin-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  container.querySelector('#restoreBackupBtn').onclick = () => container.querySelector('#restoreFileInput').click()
  container.querySelector('#restoreFileInput').onchange = async (e) => {
    const file = e.target.files[0]
    e.target.value = '' // lets picking the same file again fire onchange a second time
    if (!file) return

    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      toast('Not a valid backup file')
      return
    }
    if (!backup || typeof backup !== 'object' || !backup.version) {
      toast('Not a valid backup file')
      return
    }

    const counts = [
      backup.txns?.length && `${backup.txns.length} transaction${backup.txns.length === 1 ? '' : 's'}`,
      backup.budgets?.length && `${backup.budgets.length} budget${backup.budgets.length === 1 ? '' : 's'}`,
      backup.recurring?.length && `${backup.recurring.length} repeat purchase${backup.recurring.length === 1 ? '' : 's'}`,
      backup.networth?.length && `${backup.networth.length} net worth check-in${backup.networth.length === 1 ? '' : 's'}`,
      backup.goals?.length && `${backup.goals.length} goal${backup.goals.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(', ')
    if (!counts) { toast('Backup file is empty'); return }

    const ok = await confirmDialog(`Import ${counts}? This adds new records — it won't replace or remove anything already in your account.`, 'Import', false)
    if (!ok) return

    try {
      if (backup.txns?.length) await bulkInsertTransactions(backup.txns)
      if (backup.budgets?.length) for (const b of backup.budgets) await upsertBudget(b.category, b.monthly_limit, b.budget_type)
      if (backup.recurring?.length) await bulkInsertRecurring(backup.recurring)
      if (backup.networth?.length) await bulkRestoreNetWorth(backup.networth)
      if (backup.goals?.length) await bulkInsertGoals(backup.goals)
      toast('Backup restored')
      await onDataRestored()
    } catch (e) {
      toast(e.message || 'Restore failed — some records may have been partially imported')
    }
  }

  container.querySelector('#saveDisplayNameBtn').onclick = async () => {
    const name = container.querySelector('#displayNameInput').value.trim()
    const btn = container.querySelector('#saveDisplayNameBtn')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      await updateDisplayName(name)
      toast('Display name updated')
      await onSessionChanged()
    } catch (e) {
      toast(e.message || 'Failed to update')
      btn.disabled = false
      btn.textContent = 'Save'
    }
  }

  container.querySelector('#changeEmailBtn').onclick = async () => {
    const input = container.querySelector('#newEmailInput')
    const newEmail = input.value.trim()
    if (!newEmail || !newEmail.includes('@')) { toast('Enter a valid email'); return }
    const btn = container.querySelector('#changeEmailBtn')
    btn.disabled = true
    btn.textContent = 'Sending…'
    try {
      await updateEmail(newEmail)
      toast(`Confirmation link sent to ${newEmail}`)
      input.value = ''
    } catch (e) {
      toast(e.message || 'Failed to update email')
    } finally {
      btn.disabled = false
      btn.textContent = 'Send Confirmation Link'
    }
  }

  container.querySelector('#signOutBtn').onclick = async () => {
    const ok = await confirmDialog('Sign out?', 'Sign Out')
    if (!ok) return
    await signOut()
    onSignedOut()
  }

  if (window.electronAPI?.isElectron) {
    window.electronAPI.getVersion().then(v => {
      const el = container.querySelector('#appVersion')
      if (el) el.textContent = v
    })
    container.querySelector('#checkUpdatesBtn').onclick = () => window.electronAPI.checkForUpdates()
  }
}
