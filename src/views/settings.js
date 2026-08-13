import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, BUDGET_TYPE_ORDER, CATEGORY_ICONS } from '../categories.js'
import { upsertBudget, signOut, addRecurring, updateRecurring, deleteRecurring, updateEmail, updateDisplayName, addNetWorth, deleteNetWorth } from '../supabase.js'
import { toast, downloadFile, txnsToCsv, todayISO, formatMoney, confirmDialog, frequencyLabel, escapeHtml, computeSuggestedLimits, formatDateDMY } from '../helpers.js'
import { ACCENTS, getMode, setMode, getAccent, setAccent } from '../theme.js'
import { isPrivacyMode, setPrivacyMode } from '../privacy.js'

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'annually']

// form state for the Repeat Purchases add/edit card — persists across the
// recursive re-renders this file does after every small change (same pattern
// as transactions.js's module-level filter state)
let recurringForm = null
let networthForm = null

export function renderSettings(container, opts) {
  const { budgets, txns, recurring, networth, session, onBudgetsChanged, onRecurringChanged, onNetWorthChanged, onSignedOut, onSessionChanged } = opts

  const displayName = session?.user?.user_metadata?.display_name || ''
  const suggestedLimits = computeSuggestedLimits(txns, 3)

  const budgetMap = {}
  for (const b of budgets) budgetMap[b.category] = b.monthly_limit

  const byType = {}
  for (const c of EXPENSE_CATEGORIES) {
    if (!byType[c.type]) byType[c.type] = []
    byType[c.type].push(c.name)
  }

  const mode = getMode()
  const accent = getAccent()

  const incomeByMonth = {}
  for (const t of txns) {
    if (t.type !== 'income') continue
    const key = t.date.slice(0, 7)
    incomeByMonth[key] = (incomeByMonth[key] || 0) + Number(t.amount)
  }
  const incomeMonths = Object.keys(incomeByMonth)
  const avgIncome = incomeMonths.length ? incomeMonths.reduce((s, m) => s + incomeByMonth[m], 0) / incomeMonths.length : null

  const initialTotal = Object.values(budgetMap).reduce((s, v) => s + (Number(v) || 0), 0)

  container.innerHTML = `
    <div class="top-bar"><h1>Settings</h1></div>

    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2)">Signed in as</div>
      <div style="font-weight:600;margin-top:2px">${escapeHtml(displayName) || session?.user?.email || ''}</div>
      ${displayName ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${escapeHtml(session?.user?.email || '')}</div>` : ''}
      <label style="margin-top:14px">Display Name</label>
      <input id="displayNameInput" type="text" placeholder="e.g. Alex" value="${escapeHtml(displayName)}" />
      <button class="btn secondary" id="saveDisplayNameBtn" style="margin-top:10px">Save</button>
    </div>

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

    <h2>Monthly Budget Limits</h2>
    <div class="card">
      ${BUDGET_TYPE_ORDER.map(type => `
        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px">${type}</div>
          ${byType[type].map(cat => `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div style="flex:1;font-size:14px">${cat}</div>
              <input type="number" inputmode="decimal" class="budgetInput" data-cat="${cat}" data-type="${type}"
                style="width:120px" placeholder="0" value="${budgetMap[cat] || ''}" />
            </div>
          `).join('')}
        </div>
      `).join('')}

      <div class="budget-total-row">
        <span class="lbl">Total budgeted</span>
        <span class="val" id="budgetTotalVal">${formatMoney(initialTotal)}</span>
      </div>
      ${avgIncome !== null ? `<div class="budget-income-compare" id="budgetIncomeCompare"></div>` : `<div class="budget-income-compare">Log some income transactions to compare this against your average salary.</div>`}

      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn" id="saveBudgets">Save Budgets</button>
        <button class="btn secondary" id="loadSuggested">↺ Load from Last 3 Months</button>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-top:10px">Fills the fields above from your average spend per category over the last 3 months — review before saving.</div>
    </div>

    <h2>Repeat Purchases</h2>
    ${recurringForm ? renderRecurringForm(recurringForm) : ''}
    <div class="card" style="margin-bottom:16px">
      ${recurring.length === 0 ? '<div class="empty-state">No repeat purchases yet — rent, insurance, or anything you log often.</div>' : recurring.map(r => `
        <div class="recurring-row">
          <div class="recurring-icon">${CATEGORY_ICONS[r.category] || '💵'}</div>
          <div class="recurring-main">
            <div class="recurring-name">${escapeHtml(r.category)}${r.subcategory ? ' · ' + escapeHtml(r.subcategory) : ''}</div>
            <div class="recurring-meta">${r.mode === 'auto' ? `Auto · ${frequencyLabel(r.frequency)} · next ${formatDateDMY(r.next_due)}` : 'Quick pick'}${r.active ? '' : ' · paused'}</div>
          </div>
          <div class="recurring-amt">${formatMoney(r.amount)}</div>
          <button class="recurring-edit" data-id="${r.id}">Edit</button>
        </div>
      `).join('')}
      ${!recurringForm ? '<button class="btn secondary" id="addRecurringBtn" style="margin-top:12px">+ Add Repeat Purchase</button>' : ''}
    </div>

    <div class="top-bar"><h2 style="margin:0">Net Worth</h2><button class="privacy-toggle-btn" id="privacyToggleSettings" title="${isPrivacyMode() ? 'Show balances' : 'Hide balances'}">${isPrivacyMode() ? '🙈' : '👁️'}</button></div>
    ${networthForm ? renderNetWorthForm(networthForm) : ''}
    <div class="privacy-wrap${isPrivacyMode() ? ' active' : ''}" style="margin-bottom:16px">
      <div class="card">
        ${networth.length === 0 ? '<div class="empty-state">No check-ins yet — log your account balances periodically to see a trend in Analysis.</div>' : [...networth].sort((a, b) => b.date.localeCompare(a.date)).map(n => `
          <div class="networth-row" data-id="${n.id}">
            <div class="networth-main">
              <div class="networth-date">${formatDateDMY(n.date)}</div>
              <div class="networth-breakdown">${n.items && n.items.length ? n.items.map(i => `${escapeHtml(i.name)} ${formatMoney(i.value)}`).join(' · ') : `${formatMoney(n.cash)} cash · ${formatMoney(n.invested)} invested`}</div>
            </div>
            <div class="networth-total">${formatMoney(Number(n.cash) + Number(n.invested))}</div>
            <button class="networth-delete" data-id="${n.id}">Delete</button>
          </div>
        `).join('')}
        ${!networthForm ? '<button class="btn secondary" id="addNetWorthBtn" style="margin-top:12px">+ Add Check-in</button>' : ''}
      </div>
      ${isPrivacyMode() ? '<div class="privacy-overlay">🔒 Balances hidden</div>' : ''}
    </div>

    <h2>Data</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Export all ${txns.length} transaction${txns.length === 1 ? '' : 's'} as a backup or to open in a spreadsheet.</div>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" id="exportCsv">Export CSV</button>
        <button class="btn secondary" id="exportJson">Export JSON</button>
      </div>
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
      <label style="margin-top:0">Change Email</label>
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
    downloadFile(`coin-transactions-${todayISO()}.json`, JSON.stringify(txns, null, 2), 'application/json')
  }

  function updateTotal() {
    const total = [...container.querySelectorAll('.budgetInput')].reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0)
    container.querySelector('#budgetTotalVal').textContent = formatMoney(total)
    const compareEl = container.querySelector('#budgetIncomeCompare')
    if (compareEl && avgIncome) {
      const pct = Math.round((total / avgIncome) * 100)
      compareEl.textContent = `${pct}% of your avg income — ${formatMoney(avgIncome)}/mo over ${incomeMonths.length} logged month${incomeMonths.length === 1 ? '' : 's'}`
      compareEl.style.color = total > avgIncome ? 'var(--red)' : 'var(--text2)'
    }
  }
  container.querySelectorAll('.budgetInput').forEach(input => {
    input.oninput = updateTotal
  })
  updateTotal()

  container.querySelector('#loadSuggested').onclick = async () => {
    const ok = await confirmDialog('Fill budget fields from your last 3 months of spending? This overwrites what\'s currently typed here — nothing saves until you click Save Budgets.', 'Load')
    if (!ok) return
    container.querySelectorAll('.budgetInput').forEach(input => {
      const suggested = suggestedLimits[input.dataset.cat]
      if (suggested !== undefined) input.value = suggested
    })
    updateTotal()
    toast('Loaded — review and Save Budgets when ready')
  }

  container.querySelector('#saveDisplayNameBtn').onclick = async () => {
    const name = container.querySelector('#displayNameInput').value.trim()
    const btn = container.querySelector('#saveDisplayNameBtn')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      await updateDisplayName(name)
      toast('Display name updated')
      await opts.onSessionChanged()
    } catch (e) {
      toast(e.message || 'Failed to update')
      btn.disabled = false
      btn.textContent = 'Save'
    }
  }

  container.querySelector('#saveBudgets').onclick = async () => {
    const btn = container.querySelector('#saveBudgets')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      const inputs = [...container.querySelectorAll('.budgetInput')]
      for (const input of inputs) {
        const val = parseFloat(input.value) || 0
        const prev = budgetMap[input.dataset.cat] || 0
        if (val !== prev) {
          await upsertBudget(input.dataset.cat, val, input.dataset.type)
        }
      }
      toast('Budgets saved')
      await onBudgetsChanged()
    } catch (e) {
      toast(e.message || 'Failed to save budgets')
    } finally {
      btn.disabled = false
      btn.textContent = 'Save Budgets'
    }
  }

  container.querySelector('#addRecurringBtn')?.addEventListener('click', () => {
    recurringForm = { id: null, type: 'expense', category: null, subcategory: '', amount: '', mode: 'auto', frequency: 'monthly', next_due: todayISO() }
    renderSettings(container, opts)
  })
  container.querySelectorAll('.recurring-edit').forEach(btn => {
    btn.onclick = () => {
      const r = recurring.find(x => x.id === btn.dataset.id)
      if (!r) return
      recurringForm = {
        id: r.id, type: r.type, category: r.category, subcategory: r.subcategory || '',
        amount: String(r.amount), mode: r.mode, frequency: r.frequency || 'monthly', next_due: r.next_due || todayISO(),
      }
      renderSettings(container, opts)
    }
  })
  wireRecurringForm(container, opts)

  container.querySelector('#privacyToggleSettings')?.addEventListener('click', () => {
    setPrivacyMode(!isPrivacyMode())
    renderSettings(container, opts)
  })
  container.querySelector('#addNetWorthBtn')?.addEventListener('click', () => {
    networthForm = { date: todayISO(), items: [{ name: '', category: 'cash', value: '' }] }
    renderSettings(container, opts)
  })
  container.querySelectorAll('.networth-delete').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmDialog('Delete this check-in?', 'Delete', true)
      if (!ok) return
      try {
        await deleteNetWorth(btn.dataset.id)
        toast('Deleted')
        await opts.onNetWorthChanged()
      } catch (e) {
        toast(e.message || 'Failed to delete')
      }
    }
  })
  wireNetWorthForm(container, opts)

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

function renderRecurringForm(form) {
  const categoryList = form.type === 'expense' ? EXPENSE_CATEGORIES.map(c => c.name) : INCOME_CATEGORIES
  return `
    <div class="card" style="margin-bottom:16px">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">${form.id ? 'Edit' : 'New'} Repeat Purchase</div>

      <div class="toggle-row" id="recTypeToggle">
        <button data-type="expense" class="${form.type === 'expense' ? 'active expense' : ''}">Expense</button>
        <button data-type="income" class="${form.type === 'income' ? 'active income' : ''}">Income</button>
      </div>

      <label>Category</label>
      <div class="chip-grid" id="recCatGrid">
        ${categoryList.map(c => `<div class="chip ${c === form.category ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join('')}
      </div>

      <label>Vendor / Note</label>
      <input id="recSub" type="text" placeholder="e.g. Condo, AIA Insurance" value="${escapeHtml(form.subcategory)}" />

      <label>Amount</label>
      <input id="recAmount" type="number" inputmode="decimal" placeholder="0" value="${escapeHtml(form.amount)}" />

      <label>Mode</label>
      <div class="toggle-row" id="recModeToggle">
        <button data-mode="auto" class="${form.mode === 'auto' ? 'active' : ''}">Automatic</button>
        <button data-mode="quick" class="${form.mode === 'quick' ? 'active' : ''}">Quick Pick</button>
      </div>

      ${form.mode === 'auto' ? `
        <label>Frequency</label>
        <select id="recFrequency">
          ${FREQUENCIES.map(f => `<option value="${f}" ${form.frequency === f ? 'selected' : ''}>${frequencyLabel(f)}</option>`).join('')}
        </select>
        <label>Next Due</label>
        <input id="recNextDue" type="date" value="${form.next_due}" />
        <div style="font-size:12px;color:var(--text2);margin-top:8px">Posts automatically as a real transaction the next time you open Coin on or after this date.</div>
      ` : `
        <div style="font-size:12px;color:var(--text2);margin-top:8px">Shows as a one-tap shortcut on the Add screen — nothing posts until you tap it there.</div>
      `}

      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" id="recSave">${form.id ? 'Save Changes' : 'Add'}</button>
        <button class="btn secondary" id="recCancel">Cancel</button>
        ${form.id ? '<button class="btn danger" id="recDelete">Delete</button>' : ''}
      </div>
    </div>
  `
}

function wireRecurringForm(container, opts) {
  if (!recurringForm) return

  container.querySelector('#recTypeToggle').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { recurringForm.type = btn.dataset.type; recurringForm.category = null; renderSettings(container, opts) }
  })
  container.querySelector('#recCatGrid').querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => { recurringForm.category = chip.dataset.cat; renderSettings(container, opts) }
  })
  container.querySelector('#recSub').oninput = e => { recurringForm.subcategory = e.target.value }
  container.querySelector('#recAmount').oninput = e => { recurringForm.amount = e.target.value }
  container.querySelector('#recModeToggle').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { recurringForm.mode = btn.dataset.mode; renderSettings(container, opts) }
  })
  container.querySelector('#recFrequency')?.addEventListener('change', e => { recurringForm.frequency = e.target.value })
  container.querySelector('#recNextDue')?.addEventListener('input', e => { recurringForm.next_due = e.target.value })

  container.querySelector('#recCancel').onclick = () => { recurringForm = null; renderSettings(container, opts) }

  container.querySelector('#recSave').onclick = async () => {
    const amt = parseFloat(recurringForm.amount)
    if (!amt || amt <= 0) { toast('Enter a valid amount'); return }
    if (!recurringForm.category) { toast('Pick a category'); return }
    const btn = container.querySelector('#recSave')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      const payload = {
        type: recurringForm.type,
        category: recurringForm.category,
        subcategory: recurringForm.subcategory || null,
        amount: amt,
        mode: recurringForm.mode,
        frequency: recurringForm.mode === 'auto' ? recurringForm.frequency : null,
        next_due: recurringForm.mode === 'auto' ? recurringForm.next_due : null,
        active: true,
      }
      if (recurringForm.id) {
        await updateRecurring(recurringForm.id, payload)
        toast('Saved')
      } else {
        await addRecurring(payload)
        toast('Added')
      }
      recurringForm = null
      await opts.onRecurringChanged()
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = recurringForm.id ? 'Save Changes' : 'Add'
    }
  }

  container.querySelector('#recDelete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Delete this repeat purchase?', 'Delete', true)
    if (!ok) return
    try {
      await deleteRecurring(recurringForm.id)
      toast('Deleted')
      recurringForm = null
      await opts.onRecurringChanged()
    } catch (e) {
      toast(e.message || 'Failed to delete')
    }
  })
}

function renderNetWorthForm(form) {
  return `
    <div class="card" style="margin-bottom:16px">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">New Check-in</div>
      <label style="margin-top:0">Date</label>
      <input id="nwDate" type="date" value="${form.date}" />
      <label>Accounts</label>
      ${form.items.map((it, i) => `
        <div class="nw-item-row" data-index="${i}">
          <input class="nwItemName" type="text" placeholder="e.g. KBANK Savings" value="${escapeHtml(it.name)}" />
          <select class="nwItemCategory">
            <option value="cash" ${it.category === 'cash' ? 'selected' : ''}>Cash</option>
            <option value="invested" ${it.category === 'invested' ? 'selected' : ''}>Invested</option>
          </select>
          <input class="nwItemValue" type="number" inputmode="decimal" placeholder="0" value="${escapeHtml(it.value)}" />
          <button class="nwItemRemove" type="button" ${form.items.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>
      `).join('')}
      <button class="btn secondary" id="nwAddItem" style="margin-top:8px">+ Add Account</button>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" id="nwSave">Add</button>
        <button class="btn secondary" id="nwCancel">Cancel</button>
      </div>
    </div>
  `
}

function wireNetWorthForm(container, opts) {
  if (!networthForm) return

  container.querySelector('#nwDate').oninput = e => { networthForm.date = e.target.value }
  container.querySelector('#nwCancel').onclick = () => { networthForm = null; renderSettings(container, opts) }

  container.querySelectorAll('.nw-item-row').forEach(row => {
    const i = Number(row.dataset.index)
    row.querySelector('.nwItemName').oninput = e => { networthForm.items[i].name = e.target.value }
    row.querySelector('.nwItemCategory').onchange = e => { networthForm.items[i].category = e.target.value }
    row.querySelector('.nwItemValue').oninput = e => { networthForm.items[i].value = e.target.value }
    row.querySelector('.nwItemRemove').onclick = () => {
      networthForm.items.splice(i, 1)
      renderSettings(container, opts)
    }
  })

  container.querySelector('#nwAddItem').onclick = () => {
    networthForm.items.push({ name: '', category: 'cash', value: '' })
    renderSettings(container, opts)
  }

  container.querySelector('#nwSave').onclick = async () => {
    const cleaned = networthForm.items
      .map(it => ({ name: it.name.trim(), category: it.category, value: parseFloat(it.value) || 0 }))
      .filter(it => it.name)
    if (!networthForm.date) { toast('Pick a date'); return }
    if (!cleaned.length) { toast('Add at least one named account'); return }
    const btn = container.querySelector('#nwSave')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      await addNetWorth({ date: networthForm.date, items: cleaned })
      toast('Check-in added')
      networthForm = null
      await opts.onNetWorthChanged()
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = 'Add'
    }
  }
}
