import './style.css'
import { getSession, onAuthChange, fetchTransactions, fetchBudgets, fetchRecurring, addTransaction, updateRecurring, fetchNetWorth, fetchSuggestions, fetchGoals } from './supabase.js'
import { renderAuth } from './views/auth.js'
import { renderQuickAdd } from './views/quickAdd.js'
import { renderTransactions } from './views/transactions.js'
import { renderDashboard } from './views/dashboard.js'
import { renderAnalysis } from './views/analysis.js'
import { renderSettings } from './views/settings.js'
import { renderAsk } from './views/ask.js'
import { renderBudget } from './views/budget.js'
import { openNetWorthCheckins } from './netWorthCheckins.js'
import { toast, cacheData, getCachedData, todayISO, advanceDate, sortByDateDesc, formatMoney } from './helpers.js'
import { categoryBudgetType } from './categories.js'
import { applyTheme } from './theme.js'
import { isDesktopView, onDesktopViewChange } from './platform.js'
import { monthlyRollup, netWorthTimeline } from './analysisData.js'
import { isPrivacyMode, setPrivacyMode, privacyToggleHtml } from './privacy.js'

applyTheme()

// AI Q&A is built (see views/ask.js, api/ask.js) but needs an OPENAI_API_KEY
// set in Vercel before it can answer anything — hidden from the tab bar
// until that's done. The 'ask' view branch below stays wired so flipping
// this back on is a one-line change.
const ASK_ENABLED = false

const app = document.getElementById('app')

// render() already fully rebuilds #app on every state change, so reacting to
// a desktop/mobile breakpoint crossing this way (rather than a resize
// listener with its own diffing) is consistent with the existing pattern,
// not new architecture. Lets Analysis's investment section (and anything
// else that forks by isDesktopView()) swap live instead of only on next nav.
onDesktopViewChange(() => render())

// Electron's global shortcut (main.cjs, CommandOrControl+Shift+A) sends this
// after focusing the window — setView isn't defined yet at this point in the
// module (function declarations are hoisted, so this still resolves fine by
// the time the event actually fires, well after boot() has run).
window.electronAPI?.onNavigate?.((view) => setView(view))

const now = new Date()
const state = {
  session: null,
  view: 'dashboard',
  txns: [],
  budgets: [],
  recurring: [],
  networth: [],
  suggestions: [],
  goals: [],
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
  try {
    state.recurring = await fetchRecurring()
  } catch {
    // table may not exist yet on an older install, or we're offline — keep
    // whatever's already in memory rather than failing the whole refresh
  }
  try {
    state.suggestions = await fetchSuggestions()
  } catch {
    // table may not exist yet on an older install, or we're offline — keep
    // whatever's already in memory rather than failing the whole refresh
  }
}

async function loadNetWorth() {
  try {
    state.networth = await fetchNetWorth()
  } catch {
    state.networth = [] // table may not exist yet on an older install — best-effort, not fatal
  }
}

async function loadGoals() {
  try {
    state.goals = await fetchGoals()
  } catch {
    state.goals = [] // table may not exist yet on an older install — best-effort, not fatal
  }
}

// Posts any 'auto' repeat purchase whose next_due date has arrived as a real
// transaction, then advances next_due — looping per item in case the app was
// closed across more than one period (e.g. monthly rent, two months unopened).
// addTransaction for a period has already succeeded by the time this runs —
// a transient failure here (unlike addTransaction failing) would leave
// next_due stale and cause that same period to be reposted as a duplicate on
// the next launch, so it's worth a couple of retries before giving up.
async function updateRecurringWithRetry(id, patch, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await updateRecurring(id, patch)
    } catch (e) {
      if (i === attempts) throw e
      await new Promise(r => setTimeout(r, 500 * i))
    }
  }
}

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
  let failed = false
  for (const r of due) {
    let nextDue = r.next_due
    try {
      while (nextDue <= today) {
        await addTransaction({
          type: r.type,
          amount: r.amount,
          date: nextDue,
          category: r.category,
          subcategory: r.subcategory,
          notes: r.notes,
          budget_type: r.type === 'expense' ? categoryBudgetType(r.category) : null,
          is_credit_card: r.is_credit_card || false,
          is_shopee: r.is_shopee || false,
        })
        logged++
        nextDue = advanceDate(nextDue, r.frequency)
        // persist progress after every period, not just at the end — if a
        // later period in this same item fails, we don't want the next
        // launch re-posting the ones that already succeeded as duplicates
        await updateRecurringWithRetry(r.id, { next_due: nextDue })
      }
    } catch (e) {
      failed = true
      console.error('processRecurring failed for', r.category, r.subcategory, e)
      // keep going — one item's failure shouldn't block the others in this batch
    }
  }
  if (failed) toast('Some repeat purchases failed to log — check Settings and try again later')
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

async function refreshAndRender(nextView, savedTxn) {
  if (savedTxn) {
    // addTransaction/updateTransaction already returned the saved row — merge
    // it into state and render right away instead of blocking the form's
    // reappearance on a full Supabase refetch (that's what made "Save & Add
    // Another" feel laggy). A background reload still runs after, for
    // eventual consistency, but deliberately doesn't trigger another render:
    // this same code path fires while the user may already be mid-typing the
    // next entry on the Add screen, and a forced rebuild there would wipe
    // their in-progress input/focus. The next natural render (any
    // navigation) picks up the reconciled state.txns automatically.
    const idx = state.txns.findIndex(t => t.id === savedTxn.id)
    state.txns = idx === -1
      ? sortByDateDesc([...state.txns, savedTxn])
      : sortByDateDesc([...state.txns.slice(0, idx), savedTxn, ...state.txns.slice(idx + 1)])
    if (nextView) state.view = nextView
    state.editingTxn = null
    render()
    loadData().catch(e => toast(e.message || 'Failed to sync'))
    return
  }
  try {
    await loadData()
  } catch (e) {
    toast(e.message || 'Failed to load data')
  }
  if (nextView) state.view = nextView
  state.editingTxn = null
  render()
}

// render() rebuilds #app from scratch on every state change (no diffing
// anywhere in this app) — wrapping that in the View Transition API turns an
// instant swap into a brief native crossfade, for free, without touching any
// of the ~15 call sites that already call render(). Falls back to the plain
// swap in browsers without support, and is skipped outright when the person
// has asked their OS for reduced motion (motion.md: "make motion optional").
function render() {
  const skip = !document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (skip) renderImmediate()
  else document.startViewTransition(() => renderImmediate())
}

function renderImmediate() {
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
      networth: state.networth,
      onNetWorthChanged: async () => { await loadNetWorth(); render(); return state.networth },
      recurring: state.recurring,
      onBillsChanged: async () => { await loadData(); render() },
      suggestions: state.suggestions,
      onSuggestionsChanged: async () => { await loadData(); render() },
      goals: state.goals,
      onGoalsChanged: async () => { await loadGoals(); render(); return state.goals },
    })
  } else if (state.view === 'transactions') {
    renderTransactions(screen, {
      txns: state.txns,
      budgets: state.budgets,
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
      onSaved: (stayOnAdd, savedTxn) => refreshAndRender(stayOnAdd ? undefined : 'transactions', savedTxn),
      onRecurringChanged: async () => { state.recurring = await fetchRecurring(); render(); return state.recurring },
    })
  } else if (state.view === 'analysis') {
    renderAnalysis(screen, {
      txns: state.txns,
      budgets: state.budgets,
      recurring: state.recurring,
      networth: state.networth,
    })
  } else if (state.view === 'budget') {
    renderBudget(screen, {
      budgets: state.budgets,
      txns: state.txns,
      onBudgetsChanged: async () => { state.budgets = await fetchBudgets(); render() },
    })
  } else if (state.view === 'settings') {
    renderSettings(screen, {
      budgets: state.budgets,
      txns: state.txns,
      recurring: state.recurring,
      networth: state.networth,
      goals: state.goals,
      session: state.session,
      onSessionChanged: async () => { state.session = await getSession(); render() },
      onSignedOut: () => { state.session = null; render() },
      // backup restore can touch all five tables at once — one combined
      // refresh instead of chaining the single-table callbacks above
      onDataRestored: async () => { await loadData(); await loadNetWorth(); await loadGoals(); render() },
    })
  } else if (state.view === 'ask') {
    renderAsk(screen, {
      txns: state.txns,
      budgets: state.budgets,
      networth: state.networth,
      session: state.session,
    })
  }

  const tabbar = document.createElement('div')
  tabbar.className = 'tabbar'
  tabbar.innerHTML = `
    <div class="tabbar-brand">
      <img src="/favicon.svg" alt="" class="tabbar-brand-logo" />
      <span class="tabbar-brand-name">Coin</span>
    </div>
    <div class="nav-label">Overview</div>
    <button class="tab ${state.view === 'dashboard' ? 'active' : ''}" data-view="dashboard">
      <span style="font-size:20px">🏠</span><span>Home</span>
    </button>
    <button class="tab ${state.view === 'transactions' ? 'active' : ''}" data-view="transactions">
      <span style="font-size:20px">📜</span><span>History</span>
    </button>
    <button class="tab ${state.view === 'add' ? 'active' : ''}" data-view="add">
      <span style="font-size:20px">➕</span><span>Add</span>
    </button>
    <div class="nav-label">Planning</div>
    <button class="tab ${state.view === 'budget' ? 'active' : ''}" data-view="budget">
      <span style="font-size:20px">🎯</span><span>Budget</span>
    </button>
    <div class="nav-label">Analysis</div>
    <button class="tab ${state.view === 'analysis' ? 'active' : ''}" data-view="analysis">
      <span style="font-size:20px">📊</span><span>Analysis</span>
    </button>
    ${ASK_ENABLED ? `
    <button class="tab ${state.view === 'ask' ? 'active' : ''}" data-view="ask">
      <span style="font-size:20px">💬</span><span>Ask</span>
    </button>
    ` : ''}
    <div class="nav-label">System</div>
    <button class="tab ${state.view === 'settings' ? 'active' : ''}" data-view="settings">
      <span style="font-size:20px">⚙️</span><span>Settings</span>
    </button>
  `
  tabbar.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => setView(btn.dataset.view)
  })

  // Desktop-sidebar-only footer panel (Ledger-inspired): a mini this-month
  // summary + net worth snapshot, built only when the sidebar is actually
  // showing — same JS-level device fork already used for Analysis's
  // investment section, so mobile renders never pay for this computation.
  if (isDesktopView()) {
    const thisMonth = monthlyRollup(state.txns, 1)[0]
    const nwTimeline = netWorthTimeline(state.networth)
    const latestNw = nwTimeline[nwTimeline.length - 1]
    const privacyOn = isPrivacyMode()

    const sidebarFooter = document.createElement('div')
    sidebarFooter.className = 'sidebar-footer'
    sidebarFooter.innerHTML = `
      <div class="sidebar-month-summary">
        <div class="sms-label">This Month</div>
        <div class="sms-row"><span class="sms-key">Income</span><span class="sms-val pos">${formatMoney(thisMonth?.income || 0)}</span></div>
        <div class="sms-row"><span class="sms-key">Expenses</span><span class="sms-val neg">${formatMoney(thisMonth?.expense || 0)}</span></div>
        <div class="sms-divider"></div>
        <div class="sms-row"><span class="sms-key">Net</span><span class="sms-val">${formatMoney((thisMonth?.income || 0) - (thisMonth?.expense || 0))}</span></div>
      </div>
      <div class="sidebar-nw-panel">
        <div class="sms-row" style="margin-bottom:0">
          <span class="sms-label" style="margin-bottom:0">Net Worth</span>
          ${privacyToggleHtml('sidebarPrivacyToggle')}
        </div>
        <div class="privacy-wrap${privacyOn ? ' active' : ''}">
          <div class="sidebar-nw-total">${latestNw ? formatMoney(latestNw.total) : '—'}</div>
          <div class="privacy-overlay">🔒 Hidden</div>
        </div>
      </div>
    `
    sidebarFooter.querySelector('#sidebarPrivacyToggle').onclick = (e) => {
      setPrivacyMode(!isPrivacyMode())
      const on = isPrivacyMode()
      const btn = e.currentTarget
      sidebarFooter.querySelector('.sidebar-nw-panel .privacy-wrap').classList.toggle('active', on)
      btn.textContent = on ? '🙈' : '👁️'
      btn.title = on ? 'Show balances' : 'Hide balances'
    }
    tabbar.appendChild(sidebarFooter)
  }

  // Shown on web too (not just Electron) so it's obvious at a glance whether
  // a deploy actually landed, instead of guessing from PWA/service-worker cache.
  const footer = document.createElement('div')
  footer.className = 'tabbar-footer'
  footer.innerHTML = `Coin v<span id="tabbarVersion">${__APP_VERSION__}</span> · Alex Kim`
  tabbar.appendChild(footer)
  if (window.electronAPI?.isElectron) {
    window.electronAPI.getVersion().then(v => {
      const el = footer.querySelector('#tabbarVersion')
      if (el) el.textContent = v
    })
  }

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
      await loadNetWorth()
      await loadGoals()
    } catch (e) {
      toast(e.message || 'Failed to load data')
    }
  }
  state.loading = false
  render()
}

boot()
