import './style.css'
import { getSession, onAuthChange, fetchTransactions, fetchBudgets } from './supabase.js'
import { renderAuth } from './views/auth.js'
import { renderQuickAdd } from './views/quickAdd.js'
import { renderTransactions } from './views/transactions.js'
import { renderDashboard } from './views/dashboard.js'
import { renderSettings } from './views/settings.js'
import { toast } from './helpers.js'

const app = document.getElementById('app')

const now = new Date()
const state = {
  session: null,
  view: 'dashboard',
  txns: [],
  budgets: [],
  year: now.getFullYear(),
  month: now.getMonth(),
  editingTxn: null,
  loading: true,
}

async function loadData() {
  const [txns, budgets] = await Promise.all([fetchTransactions(), fetchBudgets()])
  state.txns = txns
  state.budgets = budgets
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
      onMonthChange: setMonth,
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
      onSaved: () => refreshAndRender('transactions'),
    })
  } else if (state.view === 'settings') {
    renderSettings(screen, {
      budgets: state.budgets,
      session: state.session,
      onBudgetsChanged: async () => { state.budgets = await fetchBudgets(); render() },
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
    await loadData()
  }
  state.loading = false
  render()
}

boot()
