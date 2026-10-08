import { addNetWorth, deleteNetWorth } from './supabase.js'
import { toast, confirmDialog, formatMoney, formatDateDMY, sortByDateDesc, todayISO, escapeHtml } from './helpers.js'
import { isPrivacyMode, setPrivacyMode, privacyToggleHtml } from './privacy.js'
import { latestAccountValues } from './analysisData.js'
import { seedNetWorthItems, netWorthItemRowsHtml, wireNetWorthItemRows, cleanNetWorthItems, findInvalidNetWorthItem } from './netWorthForm.js'

// Same markPaidDialog.js/balanceForecastDialog.js overlay pattern — a
// self-closing popup appended straight to document.body. Reached by tapping the
// Dashboard's Net Worth widget — this is the one place net worth can be
// edited (check-in history + delete + "Add Check-in"); the sidebar panel is
// read-only by design.
export function openNetWorthCheckins({ networth, onNetWorthChanged }) {
  // `networth` is a snapshot from whenever the dialog opened — main.js's
  // onNetWorthChanged callback refetches and returns the fresh array after
  // every save/delete, reassigned here so the list doesn't go stale while
  // the dialog stays open across multiple edits.
  let data = networth
  // Reset every time the dialog opens — unlike the old Settings section
  // (always mounted, so a half-filled form sticking around across renders
  // was fine), a popup shouldn't reopen with stale in-progress state.
  let form = null

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    const privacyOn = isPrivacyMode()
    overlay.innerHTML = `
      <div class="confirm-box modal-box-lg">
        <div class="nwq-title" style="display:flex;align-items:center;justify-content:space-between">
          <span>Net Worth</span>
          ${privacyToggleHtml('privacyToggleNwc')}
        </div>
        <div class="nwq-sub">Check-in history — tap Delete to remove one, or add a new check-in below.</div>

        ${form ? formHtml(form) : ''}

        <div class="privacy-wrap${privacyOn ? ' active' : ''}">
          <div class="nwq-rows">
            ${data.length === 0 ? '<div class="empty-state">No check-ins yet — log your account balances periodically to see a trend in Analysis.</div>' : sortByDateDesc(data).map(n => `
              <div class="networth-row" data-id="${n.id}">
                <div class="networth-main">
                  <div class="networth-date">${formatDateDMY(n.date)}</div>
                  <div class="networth-breakdown">${n.items && n.items.length ? n.items.map(i => `${escapeHtml(i.name)} ${formatMoney(i.value)}`).join(' · ') : `${formatMoney(n.cash)} cash · ${formatMoney(n.invested)} invested`}</div>
                </div>
                <div class="networth-total">${formatMoney(n.items && n.items.length ? n.items.reduce((s, i) => s + Number(i.value), 0) : Number(n.cash) + Number(n.invested))}</div>
                <button class="networth-delete" data-id="${n.id}">Delete</button>
              </div>
            `).join('')}
          </div>
          ${!form ? '<button class="btn secondary" id="nwcAddBtn" style="margin-top:12px">+ Add Check-in</button>' : ''}
          <div class="privacy-overlay">🔒 Balances hidden</div>
        </div>
      </div>
    `
    wire()
  }

  // onNetWorthChanged's app-level render() rebuilds #app (to keep the
  // dashboard/sidebar in sync), but this overlay lives on document.body (not
  // #app) so it's unaffected — refresh() only needs to pull the fresh data
  // back and redraw itself.
  async function refresh() {
    data = await onNetWorthChanged()
    render()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }

    const privacyBtn = overlay.querySelector('#privacyToggleNwc')
    if (privacyBtn) {
      privacyBtn.onclick = () => {
        setPrivacyMode(!isPrivacyMode())
        const on = isPrivacyMode()
        overlay.querySelectorAll('.privacy-wrap').forEach(w => w.classList.toggle('active', on))
        privacyBtn.textContent = on ? '🙈' : '👁️'
        privacyBtn.title = on ? 'Show balances' : 'Hide balances'
      }
    }

    overlay.querySelectorAll('.networth-delete').forEach(btn => {
      btn.onclick = async () => {
        const ok = await confirmDialog('Delete this check-in?', 'Delete', true)
        if (!ok) return
        try {
          await deleteNetWorth(btn.dataset.id)
          toast('Deleted')
          await refresh()
        } catch (e) {
          toast(e.message || 'Failed to delete')
        }
      }
    })

    overlay.querySelector('#nwcAddBtn')?.addEventListener('click', () => {
      form = { date: todayISO(), items: seedNetWorthItems(latestAccountValues(data)) }
      render()
    })

    if (form) {
      overlay.querySelector('#nwDate').oninput = e => { form.date = e.target.value }
      overlay.querySelector('#nwCancel').onclick = () => { form = null; render() }
      wireNetWorthItemRows(overlay, form.items, { onChange: render })
      overlay.querySelector('#nwAddItem').onclick = () => {
        form.items.push({ name: '', category: 'cash', value: '', lastValue: null })
        render()
      }
      overlay.querySelector('#nwSave').onclick = async () => {
        const invalidRow = findInvalidNetWorthItem(form.items)
        if (invalidRow) { toast(`Can't work out "${invalidRow.value}" for ${invalidRow.name.trim()}`); return }
        const cleaned = cleanNetWorthItems(form.items)
        if (!form.date) { toast('Pick a date'); return }
        if (!cleaned.length) { toast('Add at least one named account'); return }
        const btn = overlay.querySelector('#nwSave')
        btn.disabled = true
        btn.textContent = 'Saving…'
        try {
          await addNetWorth({ date: form.date, items: cleaned })
          toast('Check-in added')
          form = null
          await refresh()
        } catch (e) {
          toast(e.message || 'Failed to save')
          btn.disabled = false
          btn.textContent = 'Add'
        }
      }
    }
  }

  function close() { overlay.remove() }

  render()
}

function formHtml(form) {
  return `
    <div class="card" style="margin-bottom:16px">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">New Check-in</div>
      <label style="margin-top:0">Date</label>
      <input id="nwDate" type="date" value="${form.date}" />
      <label>Accounts</label>
      ${netWorthItemRowsHtml(form.items)}
      <div style="font-size:11.5px;color:var(--text3);margin-top:6px">Leave a balance blank to skip that account this time — it won't be zeroed out.</div>
      <button class="btn secondary" id="nwAddItem" style="margin-top:8px">+ Add Account</button>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" id="nwSave">Add</button>
        <button class="btn secondary" id="nwCancel">Cancel</button>
      </div>
    </div>
  `
}
