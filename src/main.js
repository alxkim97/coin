import './style.css'
import { getSession, onAuthChange, fetchTransactions, fetchBudgets, fetchRecurring, addTransaction, updateRecurring } from './supabase.js'
import { renderAuth } from './views/auth.js'
import { renderQuickAdd } from './views/quickAdd.js'
import { renderTransactions } from './views/transactions.js'
import { renderDashboard } from './views/dashboard.js'
import { renderSettings } from './views/settings.js'
import { toast, cacheData, getCachedData, todayISO, advanceDate } from './helpers.js'
import { categoryBudgetType } from './categories.js'
import { applyTheme } from './theme.js'

applyTheme()

const app = document.getElementById('app')

const now = new Date()
const state = {
  session: null,
  view: 'dashboard',
  txns: [],
  budgets: [],
  recurring: [],
  year: now.getFullYear(),
  month: now.getMonth(),
  range: 1,
  editingTxn: null,
  loading: true,
}

async function loadData() {
  try {
    const [txns, budgets] = await Promise.all([fetchTransactions(), fetchBudgets()])
    state.txns = txns
    state.budgets = budgets
    cacheData(txns, budgets)
  } catch (e) {
    const cached = getCachedData()
    if (!cached) throw e
    state.txns = cached.txns
    state.budgets = cached.budgets
    toast('Offline — showing your last synced data')
  }
}

// Posts any 'auto' repeat purchase whose next_due date has arrived as a real
// transaction, then advances next_due — looping per item in case the app was
// closed across more than one period (e.g. monthly rent, two months unopened).
async function processRecurring() {
  try {
    state.recurring = await fetchRecurring()
  } catch {
    return // table may not exist yet on an older install — best-effort, not fatal
  }
  const today = todayISO()
  const due = state.recurring.filter(r => r.active && r.mode === 'auto' && r.next_due && r.next_due <= today)
  if (!due.length) return

  let logged = 0
  for (const r of due) {
    let nextDue = r.next_due
    while (nextDue <= today) {
      await addTransaction({
        type: r.type,
        amount: r.amount,
        date: nextDue,
        category: r.category,
        subcategory: r.subcategory,
        notes: r.notes,
        budget_type: r.type === 'expense' ? categoryBudgetType(r.category) : null,
      })
      logged++
      nextDue = advanceDate(nextDue, r.frequency)
    }
    await updateRecurring(r.id, { next_due: nextDue })
  }
  if (logged) {
    toast(`Auto-logged ${logged} repeat purchase${logged === 1 ? '' : 's'}`)
    await loadData()
    state.recurring = await fetchRecurring()
  }
}

function setView(view, opts = {}) {
  state.view = view
  state.editingTxn = opts.editingTxn || null
  render()
}

function setMonth(year, month) {
  state.year = year
  state.month = month
  render()
}

function setRange(range) {
  state.range = range
  render()
}

async function refreshAndRender(nextView) {
  try {
    await loadData()
  } catch (e) {
    toast(e.message || 'Failed to load data')
  }
  if (nextView) state.view = nextView
  state.editingTxn = null
  render()
}

function render() {
  app.innerHTML = ''

  if (!state.session) {
    renderAuth(app, {
      onSignedIn: async () => {
        state.session = await getSession()
        await refreshAndRender('dashboard')
      },
    })
    return
  }

  if (state.loading) {
    app.innerHTML = '<div class="center-screen"><div class="empty-state">Loading…</div></div>'
    return
  }

  const screen = document.createElement('div')
  screen.className = 'screen'
  app.appendChild(screen)

  if (state.view === 'dashboard') {
    renderDashboard(screen, {
      txns: state.txns,
      budgets: state.budgets,
      year: state.year,
      month: state.month,
      range: state.range,
      onMonthChange: setMonth,
      onRangeChange: setRange,
    })
  } else if (state.view === 'transactions') {
    renderTransactions(screen, {
      txns: state.txns,
      year: state.year,
      month: state.month,
      onMonthChange: setMonth,
      onEditTxn: (txn) => setView('add', { editingTxn: txn }),
    })
  } else if (state.view === 'add') {
    renderQuickAdd(screen, {
      editingTxn: state.editingTxn,
      recurring: state.recurring,
      txns: state.txns,
      onSaved: () => refreshAndRender('transactions'),
    })
  } else if (state.view === 'settings') {
    renderSettings(screen, {
      budgets: state.budgets,
      txns: state.txns,
      recurring: state.recurring,
      session: state.session,
      onBudgetsChanged: async () => { state.budgets = await fetchBudgets(); render() },
      onRecurringChanged: async () => { state.recurring = await fetchRecurring(); render() },
      onSessionChanged: async () => { state.session = await getSession(); render() },
      onSignedOut: () => { state.session = null; render() },
    })
  }

  const tabbar = document.createElement('div')
  tabbar.className = 'tabbar'
  tabbar.innerHTML = `
    <button class="tab ${state.view === 'dashboard' ? 'active' : ''}" data-view="dashboard">
      <span style="font-size:20px">🏠</span><span>Home</span>
    </button>
    <button class="tab ${state.view === 'transactions' ? 'active' : ''}" data-view="transactions">
      <span style="font-size:20px">📜</span><span>History</span>
    </button>
    <button class="tab ${state.view === 'add' ? 'active' : ''}" data-view="add">
      <span style="font-size:20px">➕</span><span>Add</span>
    </button>
    <button class="tab ${state.view === 'settings' ? 'active' : ''}" data-view="settings">
      <span style="font-size:20px">⚙️</span><span>Settings</span>
    </button>
  `
  tabbar.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => setView(btn.dataset.view)
  })
  app.appendChild(tabbar)
}

async function boot() {
  state.session = await getSession()
  onAuthChange((session) => {
    state.session = session
  })
  if (state.session) {
    try {
      await loadData()
      await processRecurring()
    } catch (e) {
      toast(e.message || 'Failed to load data')
    }
  }
  state.loading = false
  render()
}

boot()
