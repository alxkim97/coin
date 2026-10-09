import './style.css'
import './desktop.css'
import { getSession, onAuthChange, fetchTransactions, fetchBudgets, fetchRecurring, addTransaction, claimRecurringPeriod, fetchNetWorth, fetchSuggestions, fetchGoals, fetchProjectionEvents, sweepOrphanReceipts, fetchDelegates, updateDelegate } from './supabase.js'
import { renderAuth } from './views/auth.js'
import { renderQuickAdd } from './views/quickAdd.js'
import { renderTransactions } from './views/transactions.js'
import { renderDashboard } from './views/dashboard.js'
import { renderAnalysis } from './views/analysis.js'
import { renderSettings } from './views/settings.js'
import { renderAsk } from './views/ask.js'
import { renderBudget } from './views/budget.js'
import { icon } from './icons.js'
import { openNetWorthCheckins } from './netWorthCheckins.js'
import { toast, cacheData, getCachedData, clearCachedData, todayISO, advanceDate, sortByDateDesc, formatMoney } from './helpers.js'
import { categoryBudgetType } from './categories.js'
import { applyTheme, setMode } from './theme.js'
import { initUpdateReload } from './swUpdate.js'
import { initReceiptBadges } from './receiptViewer.js'
import { isEditWindowOpen, formatUntil } from './claudeAccess.js'
import { isDesktopView, onDesktopViewChange } from './platform.js'
import { setupPullToRefresh } from './pullToRefresh.js'
import { netWorthTimeline } from './analysisData.js'
import { isPrivacyMode, setPrivacyMode, privacyToggleHtml, syncPrivacyButton, privacyOverlayHtml } from './privacy.js'
import { effectiveDate, monthRange } from './helpers.js'
import { renderTopbar } from './desktop/topbar.js'
import { renderDashboardDesktop } from './desktop/dashboard.js'
import { renderHistoryDesktop, setHistorySearch, getHistorySearch, applyHistorySearch, renderRecentlyAdded } from './desktop/history.js'
import { renderBudgetDesktop } from './desktop/budget.js'
import { renderAnalysisDesktop } from './desktop/analysis.js'
import { renderSettingsDesktop } from './desktop/settings.js'
import { renderProjectionDesktop } from './desktop/projection.js'
import { renderTaxDesktop } from './desktop/tax.js'
import { record as recordUndo, clearUndo, undo, redo, undoLabel, redoLabel, addedAction, editedAction, deletedAction } from './desktop/undo.js'

applyTheme()
initReceiptBadges()

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

// phone only, and only where a refresh can't discard anything half-typed
setupPullToRefresh({
  isEnabled: () => !isDesktopView() && !!state.session && !state.customizing && state.view !== 'add' && !document.querySelector('.budgetInput'),
  onRefresh: async () => {
    try { await loadData() } catch (e) { toast(e.message || 'Failed to refresh'); return }
    await loadNetWorth()
    await loadGoals()
    render()
  },
})

// Electron's global shortcut (main.cjs, CommandOrControl+Shift+A) sends this
// after focusing the window — setView isn't defined yet at this point in the
// module (function declarations are hoisted, so this still resolves fine by
// the time the event actually fires, well after boot() has run).
window.electronAPI?.onNavigate?.((view) => setView(view))

// iOS Safari ignores user-scalable=no, so block pinch-zoom via its gesture
// events (Safari-only; no-op on desktop/Android, where the meta tag suffices).
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })

// Escape closes the topmost popup. Every popup already closes on a click on
// its dimmed backdrop (each one checks e.target === overlay), so this replays
// exactly that click — each dialog runs its own close path (confirmDialog
// resolves false, etc.) instead of the overlay being yanked out from under it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  const overlays = document.querySelectorAll('.confirm-overlay')
  const top = overlays[overlays.length - 1]
  if (top) top.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})

// Desktop shortcuts (Ledger's): Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo,
// Ctrl+S save whatever form is open. Undo/redo leave text fields alone so
// the browser's own typing undo still works there.
const SAVE_BUTTONS = ['#saveBtn', '#bSave', '.pSave', '.aAcctSave', '#nwSave']
document.addEventListener('keydown', (e) => {
  if (!isDesktopView() || !state.session || !(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]')
  if (k === 's') {
    e.preventDefault()
    const btn = SAVE_BUTTONS.map(sel => document.querySelector(sel)).find(b => b && !b.disabled && b.offsetParent)
    if (btn) btn.click()
    else toast('Nothing to save on this page')
    return
  }
  if (typing) return
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); runUndo('undo') }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); runUndo('redo') }
})

async function runUndo(which) {
  try {
    const a = await (which === 'undo' ? undo() : redo())
    if (!a) { toast(which === 'undo' ? 'Nothing to undo' : 'Nothing to redo'); return }
    toast(`${which === 'undo' ? 'Undid' : 'Redid'} ${a.label}`)
    await loadData()
    render()
  } catch (err) {
    toast(err.message || `Couldn't ${which}`)
  }
}

// Ledger's logo gimmick: click the sidebar logo to cycle it. Index 0 is
// Coin's own mark; the rest are emoji, remembered per device.
const LOGO_FACES = [null, '🪙', '💰', '💸', '💵', '🤑', '💎', '📈', '🐷']
let logoIdx = Number(localStorage.getItem('coin_logo_idx') || 0) % LOGO_FACES.length
// …and it changes by itself every 30 minutes while the app is open
setInterval(() => {
  if (!isDesktopView()) return
  logoIdx = (logoIdx + 1) % LOGO_FACES.length
  try { localStorage.setItem('coin_logo_idx', String(logoIdx)) } catch { /* resets next launch */ }
  const el = document.querySelector('#brandLogo')
  if (el) { el.innerHTML = logoFaceHtml(); el.classList.remove('spin'); void el.offsetWidth; el.classList.add('spin') }
}, 30 * 60 * 1000)
function logoFaceHtml() {
  const face = LOGO_FACES[logoIdx]
  return face ? `<span class="tabbar-brand-emoji">${face}</span>` : '<img src="./favicon.svg" alt="" />'
}

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
  projectionEvents: [],
  projectionEventsReady: true, // false until coin_projection_events exists
  delegates: [], // Claude helper accounts (Settings → Claude access)
  year: now.getFullYear(),
  month: now.getMonth(),
  range: 1,
  editingTxn: null,
  loading: true,
  // desktop-only: dashboard Customize mode (drag/hide widgets)
  customizing: false,
}

// Desktop-only destinations — the phone tab bar has no slot for them, so a
// window shrunk below the breakpoint while on one falls back to Dashboard.
const DESKTOP_ONLY_VIEWS = new Set(['projection', 'tax'])
let refocusSearch = false

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

async function loadDelegates() {
  try {
    state.delegates = await fetchDelegates()
  } catch {
    state.delegates = [] // coin_delegates not created yet — feature just stays off
  }
}

async function loadProjectionEvents() {
  try {
    state.projectionEvents = await fetchProjectionEvents()
    state.projectionEventsReady = true
  } catch {
    state.projectionEvents = [] // coin_projection_events not created yet — Projection still works from the run-rate alone
    state.projectionEventsReady = false
  }
}

// Posts any 'auto' repeat purchase whose next_due date has arrived as a real
// transaction, then advances next_due — looping per item in case the app was
// closed across more than one period (e.g. monthly rent, two months unopened).
// Each period is claimed first (next_due moved forward only if no other
// device already did) and posted second, so phone + desktop opening on the
// same due date can't both post it. If the post then fails, the claim is
// handed back so the next launch retries that period.
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
        const periodDate = nextDue
        const following = advanceDate(periodDate, r.frequency)
        if (!(await claimRecurringPeriod(r.id, periodDate, following))) break // another device has it
        nextDue = following
        try {
          await addTransaction({
            type: r.type,
            amount: r.amount,
            date: periodDate,
            category: r.category,
            subcategory: r.subcategory,
            notes: r.notes,
            budget_type: r.type === 'expense' ? categoryBudgetType(r.category) : null,
            is_credit_card: r.is_credit_card || false,
            is_shopee: r.is_shopee || false,
          })
        } catch (e) {
          await claimRecurringPeriod(r.id, following, periodDate).catch(() => {}) // hand the period back for next launch
          throw e
        }
        logged++
      }
    } catch (e) {
      failed = true
      console.error('processRecurring failed for', r.category, r.subcategory, e)
      // keep going — one item's failure shouldn't block the others in this batch
    }
  }
  if (failed) toast('Some repeat purchases failed to log — check Add → Manage repeat purchases and try again later')
  if (logged) {
    toast(`Auto-logged ${logged} repeat purchase${logged === 1 ? '' : 's'}`)
    await loadData()
    state.recurring = await fetchRecurring()
  }
}

// Drops everything tied to the old account — in-memory data, the offline
// cache, and the desktop undo stack — so a different sign-in on this device
// never sees (or replays) the previous account's data.
function signedOut() {
  state.session = null
  Object.assign(state, { delegates: [], txns: [], budgets: [], recurring: [], networth: [], suggestions: [], goals: [], projectionEvents: [], editingTxn: null, customizing: false, view: 'dashboard' })
  clearCachedData()
  clearUndo()
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
  // hidden too: the browser aborts transitions in a hidden page (still
  // running the render, but rejecting with an uncaught InvalidStateError)
  const skip = !document.startViewTransition || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (skip) renderImmediate()
  else document.startViewTransition(() => renderImmediate()).ready.catch(() => {}) // a skipped/interrupted animation isn't an error
}

let bannerTimer = null
function renderImmediate() {
  app.innerHTML = ''

  if (!state.session) {
    renderAuth(app, {
      onSignedIn: async () => {
        state.session = await getSession()
        state.loading = true
        render()
        await loadEverything()
        state.loading = false
        setView('dashboard')
      },
    })
    return
  }

  if (state.loading) {
    app.innerHTML = '<div class="center-screen"><div class="empty-state">Loading…</div></div>'
    return
  }

  const desktop = isDesktopView()
  if (!desktop && DESKTOP_ONLY_VIEWS.has(state.view)) state.view = 'dashboard'
  app.classList.toggle('desk', desktop)

  const screen = document.createElement('div')
  screen.className = 'screen view-' + state.view
  app.appendChild(screen)

  if (state.view === 'dashboard') {
    ;(desktop ? renderDashboardDesktop : renderDashboard)(screen, {
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
      customizing: state.customizing,
      onStartCustomizing: () => { state.customizing = true; render() },
      onDoneCustomizing: () => { state.customizing = false; render() },
      onNavigate: (view) => setView(view),
      onEditTxn: (txn) => setView('add', { editingTxn: txn }),
    })
  } else if (state.view === 'transactions') {
    ;(desktop ? renderHistoryDesktop : renderTransactions)(screen, {
      txns: state.txns,
      budgets: state.budgets,
      year: state.year,
      month: state.month,
      range: state.range,
      onMonthChange: setMonth,
      onEditTxn: (txn) => setView('add', { editingTxn: txn }),
    })
  } else if (state.view === 'add') {
    // desktop: the form re-renders its own host on every change, so the
    // "Recently added" table lives in a sibling element below it
    const host = desktop ? document.createElement('div') : screen
    if (desktop) {
      screen.appendChild(host)
      const recent = document.createElement('div')
      screen.appendChild(recent)
      renderRecentlyAdded(recent, state.txns, (txn) => setView('add', { editingTxn: txn }))
    }
    renderQuickAdd(host, {
      editingTxn: state.editingTxn,
      recurring: state.recurring,
      txns: state.txns,
      onSaved: (stayOnAdd, savedTxn, meta) => {
        // desktop undo/redo: remember what this save or delete changed
        if (meta?.deleted) recordUndo(deletedAction({ ...meta.deleted, receipt_path: null })) // its receipt file is already gone
        else if (savedTxn && state.editingTxn) recordUndo(editedAction(state.editingTxn, savedTxn))
        else if (savedTxn) recordUndo(addedAction(savedTxn))
        refreshAndRender(stayOnAdd ? undefined : 'transactions', savedTxn)
      },
      onRecurringChanged: async () => { state.recurring = await fetchRecurring(); render(); return state.recurring },
    })
  } else if (state.view === 'analysis') {
    ;(desktop ? renderAnalysisDesktop : renderAnalysis)(screen, {
      txns: state.txns,
      budgets: state.budgets,
      recurring: state.recurring,
      networth: state.networth,
      onNetWorthChanged: async () => { await loadNetWorth(); render(); return state.networth },
    })
  } else if (state.view === 'budget') {
    ;(desktop ? renderBudgetDesktop : renderBudget)(screen, {
      budgets: state.budgets,
      txns: state.txns,
      year: state.year,
      month: state.month,
      onBudgetsChanged: async () => { state.budgets = await fetchBudgets(); render() },
    })
  } else if (state.view === 'settings') {
    ;(desktop ? renderSettingsDesktop : renderSettings)(screen, {
      budgets: state.budgets,
      txns: state.txns,
      recurring: state.recurring,
      networth: state.networth,
      goals: state.goals,
      session: state.session,
      onSessionChanged: async () => { state.session = await getSession(); render() },
      onSignedOut: () => { signedOut(); render() },
      // backup restore can touch all five tables at once — one combined
      // refresh instead of chaining the single-table callbacks above
      onDataRestored: async () => { await loadData(); await loadNetWorth(); await loadGoals(); render() },
      onThemeChanged: () => render(),
      // a suggestion accept/undo in the card can change transactions too
      onClaudeAccessChanged: async () => { await loadDelegates(); await loadData().catch(() => {}); render() },
    })
  } else if (state.view === 'projection') {
    renderProjectionDesktop(screen, {
      txns: state.txns,
      networth: state.networth,
      events: state.projectionEvents,
      eventsReady: state.projectionEventsReady,
      onEventsChanged: async () => { await loadProjectionEvents(); render() },
    })
  } else if (state.view === 'tax') {
    renderTaxDesktop(screen, { txns: state.txns })
  } else if (state.view === 'ask') {
    renderAsk(screen, {
      txns: state.txns,
      budgets: state.budgets,
      networth: state.networth,
      session: state.session,
    })
  }

  // Always visible while Claude can write directly — never a silent window
  const editing = state.delegates.find(isEditWindowOpen)
  clearTimeout(bannerTimer)
  if (editing) {
    // drop the banner by itself when the window closes
    bannerTimer = setTimeout(() => render(), Math.min(new Date(editing.edit_until) - Date.now() + 1000, 2 ** 31 - 1))
    const banner = document.createElement('div')
    banner.className = 'claude-banner'
    banner.innerHTML = `<span>Claude can edit your transactions until <strong>${formatUntil(editing.edit_until)}</strong></span><button type="button" id="claudeStop">Stop</button>`
    banner.querySelector('#claudeStop').onclick = async () => {
      try { await updateDelegate(editing.delegate_id, { edit_until: null, edit_note: null }); toast('Direct editing stopped') } catch (e) { toast(e.message || 'Failed') }
      await loadDelegates()
      render()
    }
    screen.prepend(banner)
  }

  const tabbar = document.createElement('div')
  tabbar.className = 'tabbar'
  const tab = (view, ic, label, extraClass = '') => `
    <button class="tab ${extraClass} ${state.view === view ? 'active' : ''}" data-view="${view}">
      ${icon(ic, 20)}<span>${label}</span>
    </button>`
  // the nav wrapper is display:contents on phone, so the bottom tab bar's
  // flex row is exactly what it was before; desktop gives it a real box
  tabbar.innerHTML = `
    <div class="tabbar-brand">
      <button type="button" class="tabbar-brand-logo" id="brandLogo" title="Click to change the icon" aria-label="Change logo icon">${logoFaceHtml()}</button>
      <div><span class="tabbar-brand-name">Coin</span>${desktop ? `<span class="tabbar-brand-sub">v${__APP_VERSION__} · Alex Kim</span>` : ''}</div>
    </div>
    <div class="tabbar-nav"${desktop ? '' : ' style="display:contents"'}>
      <div class="nav-label">Overview</div>
      ${tab('dashboard', 'dashboard', desktop ? 'Dashboard' : 'Home')}
      ${tab('transactions', 'history', 'History')}
      ${desktop ? tab('add', 'add', 'Add') : `
        <button class="tab tab-add ${state.view === 'add' ? 'active' : ''}" data-view="add" aria-label="Add transaction">
          <span class="tab-add-circle">${icon('plus', 28)}</span><span>Add</span>
        </button>`}
      <div class="nav-label">Planning</div>
      ${tab('budget', 'budget', desktop ? 'Budget &amp; Limits' : 'Budget')}
      ${tab('projection', 'activity', 'Projection', 'tab-desktop-only')}
      ${tab('tax', 'fileText', 'Tax Calculator', 'tab-desktop-only')}
      <div class="nav-label">Analysis</div>
      ${tab('analysis', 'analysis', 'Analysis')}
      ${ASK_ENABLED ? tab('ask', 'chat', 'Ask') : ''}
      <div class="nav-label">System</div>
      ${tab('settings', 'settings', 'Settings', 'tab-desktop-only')}
    </div>
  `
  tabbar.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => { state.customizing = false; setView(btn.dataset.view) }
  })
  const brandLogo = tabbar.querySelector('#brandLogo')
  brandLogo.onclick = () => {
    if (!desktop) return
    logoIdx = (logoIdx + 1) % LOGO_FACES.length
    try { localStorage.setItem('coin_logo_idx', String(logoIdx)) } catch { /* storage unavailable — resets next launch */ }
    brandLogo.innerHTML = logoFaceHtml()
    brandLogo.classList.remove('spin')
    void brandLogo.offsetWidth // restart the pop animation on rapid clicks
    brandLogo.classList.add('spin')
  }

  // Desktop-sidebar-only footer panel (Ledger-inspired): a mini this-month
  // summary + net worth snapshot, built only when the sidebar is actually
  // showing — same JS-level device fork already used for Analysis's
  // investment section, so mobile renders never pay for this computation.
  if (desktop) {
    // same salary-shift rule (effectiveDate) as the Dashboard KPI cards, so
    // the sidebar and the dashboard never disagree about "this month"
    const today = new Date()
    const { from, to } = monthRange(today.getFullYear(), today.getMonth())
    let mIncome = 0, mExpense = 0
    for (const t of state.txns) {
      const d = effectiveDate(t)
      if (d < from || d > to) continue
      if (t.type === 'income') mIncome += Number(t.amount)
      else mExpense += Number(t.amount)
    }
    const nwTimeline = netWorthTimeline(state.networth)
    const latestNw = nwTimeline[nwTimeline.length - 1]
    const privacyOn = isPrivacyMode()

    const sidebarFooter = document.createElement('div')
    sidebarFooter.className = 'sidebar-footer'
    sidebarFooter.innerHTML = `
      <div class="sidebar-month-summary">
        <div class="sms-label">THIS MONTH</div>
        <div class="sms-row"><span class="sms-key">Income</span><span class="sms-val pos">${formatMoney(mIncome)}</span></div>
        <div class="sms-row"><span class="sms-key">Expenses</span><span class="sms-val neg">${formatMoney(mExpense)}</span></div>
        <div class="sms-divider"></div>
        <div class="sms-row"><span class="sms-key">Net</span><span class="sms-val ${mIncome - mExpense >= 0 ? 'pos' : 'neg'}">${formatMoney(mIncome - mExpense)}</span></div>
      </div>
      <div class="sidebar-nw-panel">
        <div class="sms-row" style="margin-bottom:0">
          <span class="sms-label" style="margin-bottom:0">NET WORTH</span>
          ${privacyToggleHtml('sidebarPrivacyToggle')}
        </div>
        <div class="privacy-wrap${privacyOn ? ' active' : ''}">
          <div class="sidebar-nw-total">${latestNw ? formatMoney(latestNw.total) : '—'}</div>
          ${privacyOverlayHtml('Hidden')}
        </div>
      </div>
    `
    sidebarFooter.querySelector('#sidebarPrivacyToggle').onclick = () => {
      setPrivacyMode(!isPrivacyMode())
      render()
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

  if (desktop) {
    const topbar = document.createElement('header')
    topbar.className = 'desk-topbar'
    app.appendChild(topbar)
    renderTopbar(topbar, {
      view: state.view,
      year: state.year,
      month: state.month,
      range: state.range,
      txns: state.txns,
      searchQuery: getHistorySearch(),
      customizing: state.customizing,
      onMonthChange: setMonth,
      onRangeChange: setRange,
      onToggleCustomize: () => { state.customizing = !state.customizing; render() },
      undoLabel: undoLabel(),
      redoLabel: redoLabel(),
      onUndo: () => runUndo('undo'),
      onRedo: () => runUndo('redo'),
      onTogglePrivacy: () => { setPrivacyMode(!isPrivacyMode()); render() },
      onToggleTheme: (isDark) => { setMode(isDark ? 'light' : 'dark'); render() },
      onAdd: () => { state.customizing = false; setView('add') },
      onSearch: (q) => {
        setHistorySearch(q)
        if (state.view === 'transactions') { applyHistorySearch(); return }
        refocusSearch = true
        setView('transactions')
      },
    })
    if (refocusSearch) {
      refocusSearch = false
      const input = topbar.querySelector('#deskSearch')
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }
}

// a new deploy reloads the app as soon as its service worker takes over —
// held back while the Add/edit form is open, so a half-typed transaction is
// never lost (it reloads when you next switch away instead; see swUpdate.js)
initUpdateReload({ isBusy: () => state.view === 'add' })

// Everything a fresh session needs — shared by app start and sign-in, so a
// sign-out → sign-in (which clears all of state) reloads every section, not
// just transactions and budgets.
async function loadEverything() {
  try {
    await loadData()
    await processRecurring()
    await loadNetWorth()
    await loadGoals()
    await loadProjectionEvents()
    await loadDelegates()
  } catch (e) {
    toast(e.message || 'Failed to load data')
  }
}

async function boot() {
  state.session = await getSession()
  onAuthChange((session) => {
    // signed out elsewhere or the session expired — back to the sign-in screen
    if (!session && state.session) { signedOut(); render(); return }
    state.session = session
  })
  if (state.session) await loadEverything()
  state.loading = false
  render()
  if (state.session) sweepReceiptsWeekly()
}

// Background, at most weekly per device, and only after a fresh (not
// offline-cached) load — the sweep keeps files the transaction list points
// at, so it must see the whole list. Failures are silent: an orphaned photo
// costs a little storage, nothing more.
const SWEEP_KEY = 'coin_receipt_sweep_at'
async function sweepReceiptsWeekly() {
  try {
    if (Date.now() - Number(localStorage.getItem(SWEEP_KEY) || 0) < 7 * 24 * 60 * 60 * 1000) return
    const txns = await fetchTransactions()
    await sweepOrphanReceipts(txns.map(t => t.receipt_path).filter(Boolean))
    localStorage.setItem(SWEEP_KEY, String(Date.now()))
  } catch { /* try again next launch */ }
}

boot()
