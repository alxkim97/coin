import { EXPENSE_CATEGORIES, BUDGET_TYPE_ORDER } from '../categories.js'
import { upsertBudget, signOut } from '../supabase.js'
import { toast, downloadFile, txnsToCsv, todayISO } from '../helpers.js'
import { ACCENTS, getMode, setMode, getAccent, setAccent } from '../theme.js'

export function renderSettings(container, { budgets, txns, onBudgetsChanged, onSignedOut, session }) {
  const budgetMap = {}
  for (const b of budgets) budgetMap[b.category] = b.monthly_limit

  const byType = {}
  for (const c of EXPENSE_CATEGORIES) {
    if (!byType[c.type]) byType[c.type] = []
    byType[c.type].push(c.name)
  }

  const mode = getMode()
  const accent = getAccent()

  container.innerHTML = `
    <div class="top-bar"><h1>Settings</h1></div>

    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2)">Signed in as</div>
      <div style="font-weight:600;margin-top:2px">${session?.user?.email || ''}</div>
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
      <button class="btn" id="saveBudgets">Save Budgets</button>
    </div>

    <h2>Data</h2>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">Export all ${txns.length} transaction${txns.length === 1 ? '' : 's'} as a backup or to open in a spreadsheet.</div>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" id="exportCsv">Export CSV</button>
        <button class="btn secondary" id="exportJson">Export JSON</button>
      </div>
    </div>

    <h2>Account</h2>
    <div class="card">
      <button class="btn danger" id="signOutBtn">Sign Out</button>
    </div>
  `

  container.querySelector('#modeToggle').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { setMode(btn.dataset.mode); renderSettings(container, { budgets, txns, onBudgetsChanged, onSignedOut, session }) }
  })
  container.querySelector('#accentSwatches').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { setAccent(btn.dataset.accent); renderSettings(container, { budgets, txns, onBudgetsChanged, onSignedOut, session }) }
  })

  container.querySelector('#exportCsv').onclick = () => {
    downloadFile(`coin-transactions-${todayISO()}.csv`, txnsToCsv(txns), 'text/csv')
  }
  container.querySelector('#exportJson').onclick = () => {
    downloadFile(`coin-transactions-${todayISO()}.json`, JSON.stringify(txns, null, 2), 'application/json')
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

  container.querySelector('#signOutBtn').onclick = async () => {
    if (!confirm('Sign out?')) return
    await signOut()
    onSignedOut()
  }
}
