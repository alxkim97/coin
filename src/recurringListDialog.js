import { CATEGORY_ICONS } from './categories.js'
import { escapeHtml, formatMoney, formatDateDMY, frequencyLabel } from './helpers.js'
import { openRecurringForm } from './recurringFormDialog.js'

// Same overlay pattern as the other dialogs — reached from the Add page
// ("Manage Repeat Purchases" link) instead of its own tab/sidebar destination,
// since a repeat purchase is really just a template for the Add flow, not a
// separate section of the app. Editing/adding an individual item opens
// recurringFormDialog.js's popup on top of this one.
export function openRecurringList({ recurring, onRecurringChanged }) {
  // see netWorthCheckins.js's refresh() for why this is reassigned rather
  // than read once — onRecurringChanged's app-level render() wipes #app,
  // and the list would otherwise go stale across repeated edits
  let data = recurring

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    overlay.innerHTML = `
      <div class="confirm-box modal-box-lg">
        <div class="nwq-title">Repeat Purchases</div>
        <div class="nwq-rows">
          ${data.length === 0 ? '<div class="empty-state">No repeat purchases yet — rent, insurance, or anything you log often.</div>' : data.map(r => `
            <div class="recurring-row">
              <div class="recurring-icon">${CATEGORY_ICONS[r.category] || '💵'}</div>
              <div class="recurring-main">
                <div class="recurring-name">${escapeHtml(r.category)}${r.subcategory ? ' · ' + escapeHtml(r.subcategory) : ''}</div>
                <div class="recurring-meta">${
                  r.mode === 'auto' ? `Auto · ${frequencyLabel(r.frequency)} · next ${formatDateDMY(r.next_due)}`
                  : r.mode === 'remind' ? `Remind · ${frequencyLabel(r.frequency)} · next ${formatDateDMY(r.next_due)}${r.installments_total ? ` · ${r.installments_paid || 0} of ${r.installments_total} paid` : ''}`
                  : 'Quick pick'
                }${r.active ? '' : ' · paused'}</div>
              </div>
              <div class="recurring-amt">${formatMoney(r.amount)}</div>
              <button class="recurring-edit" data-id="${r.id}">Edit</button>
            </div>
          `).join('')}
        </div>
        <button class="btn secondary" id="addRecurringBtn" style="margin-top:12px">+ Add Repeat Purchase</button>

        <div class="confirm-actions" style="margin-top:16px">
          <button class="btn secondary" id="recListClose">Close</button>
        </div>
      </div>
    `
    wire()
  }

  // onRecurringChanged's app-level render() rebuilds #app, but this overlay
  // lives on document.body (not #app) so it's unaffected — refresh() only
  // needs to pull the fresh data back and redraw itself.
  async function refresh() {
    data = await onRecurringChanged()
    render()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }
    overlay.querySelector('#recListClose').onclick = close

    overlay.querySelector('#addRecurringBtn').onclick = () => {
      openRecurringForm({ item: null, onSaved: refresh })
    }
    overlay.querySelectorAll('.recurring-edit').forEach(btn => {
      btn.onclick = () => {
        const r = data.find(x => x.id === btn.dataset.id)
        if (!r) return
        openRecurringForm({ item: r, onSaved: refresh })
      }
    })
  }

  function close() { overlay.remove() }

  render()
}
