// Desktop Settings — Ledger's layout: titled cards of label/description rows
// with the control on the right. Same functions as the phone Settings, plus
// Gold as an 8th accent (desktop only).
import { toast, downloadFile, txnsToCsv, todayISO, confirmDialog, escapeHtml } from '../helpers.js'
import { signOut, updateEmail, updateDisplayName, bulkInsertTransactions, bulkInsertRecurring, bulkRestoreNetWorth, bulkInsertGoals, upsertBudget } from '../supabase.js'
import { ACCENTS, getMode, setMode, getAccent, setAccent } from '../theme.js'
import { icon } from '../icons.js'
import { headHtml, segHtml, wireSeg } from './ui.js'

const DESKTOP_ACCENTS = [...ACCENTS, { id: 'gold', label: 'Gold', swatch: '#c9a227' }]

function row(label, desc, ctrl) {
  return `<div class="d-set-row"><div><div class="d-set-label">${label}</div>${desc ? `<div class="d-set-desc">${desc}</div>` : ''}</div><div class="d-set-ctrl">${ctrl}</div></div>`
}

export function renderSettingsDesktop(container, opts) {
  const { txns, budgets, recurring, networth, goals, session, onSignedOut, onSessionChanged, onDataRestored, onThemeChanged } = opts
  const displayName = session?.user?.user_metadata?.display_name || ''
  const email = session?.user?.email || ''
  const accent = getAccent()
  const isElectron = !!window.electronAPI?.isElectron

  container.innerHTML = `
    ${headHtml('Settings', 'Appearance, data and account')}
    <div class="d-settings">
      <div class="d-set-card">
        <div class="d-set-title">Appearance</div>
        ${row('Theme', 'System follows your Windows light/dark setting.', segHtml('sMode', [{ v: 'system', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }], getMode()))}
        ${row('Accent colour', 'Buttons, links and the selected page. Net worth, goals and achievements stay gold either way.', `
          <div class="accent-swatches" id="sAccents">
            ${DESKTOP_ACCENTS.map(a => `<button class="accent-swatch ${a.id === accent ? 'active' : ''}" data-accent="${a.id}" style="background:${a.swatch};width:26px;height:26px" title="${a.label}" aria-label="${a.label}"></button>`).join('')}
          </div>`)}
        ${row('Logo', 'Click the logo at the top of the sidebar to cycle through icons.', '<span class="d-list-meta">fun mode</span>')}
      </div>

      <div class="d-set-card">
        <div class="d-set-title">Account</div>
        ${row('Signed in as', escapeHtml(email), `<span class="d-set-label">${escapeHtml(displayName) || '—'}</span>`)}
        ${row('Display name', 'Shown in the app instead of your email.', `<input id="sName" type="text" placeholder="e.g. Alex" value="${escapeHtml(displayName)}" style="width:180px" /><button class="d-btn" id="sNameSave">Save</button>`)}
        ${row('Change email', 'You get a confirmation link at the new address; nothing changes until you click it.', `<input id="sEmail" type="email" placeholder="new-email@example.com" style="width:200px" /><button class="d-btn" id="sEmailSend">Send link</button>`)}
      </div>

      <div class="d-set-card">
        <div class="d-set-title">Data</div>
        ${row('Export transactions', `All ${txns.length} transaction${txns.length === 1 ? '' : 's'} as a CSV spreadsheet.`, `<button class="d-btn" id="sCsv">${icon('fileText', 12)}Export CSV</button>`)}
        ${row('Full backup', 'Transactions, budgets, repeat purchases, net worth check-ins and goals as one JSON file.', `<button class="d-btn" id="sJson">${icon('archive', 12)}Export backup</button>`)}
        ${row('Restore from backup', 'Adds the records in a backup file — never replaces or removes anything, so restoring the same file twice duplicates it.', `<input type="file" accept="application/json" id="sRestoreFile" style="display:none" /><button class="d-btn" id="sRestore">${icon('undo', 12)}Restore…</button>`)}
      </div>

      <div class="d-set-card">
        <div class="d-set-title">${isElectron ? 'Desktop app' : 'About'}</div>
        ${row('Version', isElectron ? 'Updates download in the background and ask you to restart when ready.' : 'Shown here so it’s obvious whether a new deploy has landed.', `<span class="mono" id="sVersion">v${__APP_VERSION__}</span>${isElectron ? '<button class="d-btn" id="sUpdates">Check for updates</button>' : ''}`)}
        ${row('Made by', '', '<span class="d-list-meta">Alex Kim</span>')}
      </div>

      <div class="d-set-card danger full">
        <div class="d-set-title">Danger zone</div>
        ${row('Sign out', 'Your data stays in your account; sign back in any time.', `<button class="d-btn danger" id="sSignOut">${icon('lock', 12)}Sign out</button>`)}
      </div>
    </div>
  `

  wireSeg(container, 'sMode', v => { setMode(v); onThemeChanged ? onThemeChanged() : renderSettingsDesktop(container, opts) })
  container.querySelectorAll('#sAccents button').forEach(btn => {
    btn.onclick = () => { setAccent(btn.dataset.accent); onThemeChanged ? onThemeChanged() : renderSettingsDesktop(container, opts) }
  })

  container.querySelector('#sCsv').onclick = () => downloadFile(`coin-transactions-${todayISO()}.csv`, txnsToCsv(txns), 'text/csv')
  container.querySelector('#sJson').onclick = () => {
    const backup = { version: 1, exportedAt: new Date().toISOString(), txns, budgets, recurring, networth, goals }
    downloadFile(`coin-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }
  container.querySelector('#sRestore').onclick = () => container.querySelector('#sRestoreFile').click()
  container.querySelector('#sRestoreFile').onchange = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    let backup
    try { backup = JSON.parse(await file.text()) } catch { toast('Not a valid backup file'); return }
    if (!backup || typeof backup !== 'object' || !backup.version) { toast('Not a valid backup file'); return }
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
    const counts = [
      backup.txns?.length && plural(backup.txns.length, 'transaction'),
      backup.budgets?.length && plural(backup.budgets.length, 'budget'),
      backup.recurring?.length && plural(backup.recurring.length, 'repeat purchase'),
      backup.networth?.length && plural(backup.networth.length, 'net worth check-in'),
      backup.goals?.length && plural(backup.goals.length, 'goal'),
    ].filter(Boolean).join(', ')
    if (!counts) { toast('Backup file is empty'); return }
    if (!(await confirmDialog(`Import ${counts}? This adds new records — it won't replace or remove anything already in your account.`, 'Import'))) return
    try {
      if (backup.txns?.length) await bulkInsertTransactions(backup.txns)
      if (backup.budgets?.length) for (const b of backup.budgets) await upsertBudget(b.category, b.monthly_limit, b.budget_type)
      if (backup.recurring?.length) await bulkInsertRecurring(backup.recurring)
      if (backup.networth?.length) await bulkRestoreNetWorth(backup.networth)
      if (backup.goals?.length) await bulkInsertGoals(backup.goals)
      toast('Backup restored')
      await onDataRestored()
    } catch (err) {
      toast(err.message || 'Restore failed — some records may have been partially imported')
    }
  }

  container.querySelector('#sNameSave').onclick = async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    try {
      await updateDisplayName(container.querySelector('#sName').value.trim())
      toast('Display name updated')
      await onSessionChanged()
    } catch (err) {
      btn.disabled = false
      toast(err.message || 'Failed to update')
    }
  }
  container.querySelector('#sEmailSend').onclick = async (e) => {
    const input = container.querySelector('#sEmail')
    const newEmail = input.value.trim()
    if (!newEmail || !newEmail.includes('@')) { toast('Enter a valid email'); return }
    const btn = e.currentTarget
    btn.disabled = true
    try {
      await updateEmail(newEmail)
      toast(`Confirmation link sent to ${newEmail}`)
      input.value = ''
    } catch (err) {
      toast(err.message || 'Failed to update email')
    } finally {
      btn.disabled = false
    }
  }
  container.querySelector('#sSignOut').onclick = async () => {
    if (!(await confirmDialog('Sign out?', 'Sign out'))) return
    await signOut()
    onSignedOut()
  }
  if (isElectron) {
    window.electronAPI.getVersion().then(v => { const el = container.querySelector('#sVersion'); if (el) el.textContent = 'v' + v })
    container.querySelector('#sUpdates').onclick = () => window.electronAPI.checkForUpdates()
  }
}
