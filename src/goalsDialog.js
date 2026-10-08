import { addGoal, updateGoal, deleteGoal } from './supabase.js'
import { goalProgress, latestAccountValues } from './analysisData.js'
import { formatMoney, formatDateDMY, toast, confirmDialog, escapeHtml, dmyDateFieldHtml, wireDmyDateField } from './helpers.js'

// Same markPaidDialog.js/netWorthCheckins.js overlay pattern — a self-closing
// popup appended straight to document.body, reached by tapping the Dashboard's Goals
// widget, rather than a page hanging off Settings.
export function openGoals({ goals, networth, onGoalsChanged }) {
  // see netWorthCheckins.js's refresh() for why this is reassigned rather
  // than read once — onGoalsChanged's app-level render() wipes #app, and the
  // list would otherwise go stale across repeated edits
  let data = goals
  let form = null

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay'
  document.body.appendChild(overlay)

  function render() {
    overlay.innerHTML = `
      <div class="confirm-box modal-box-lg">
        <div class="nwq-title">Goals</div>

        ${data.length === 0 && !form ? '<div class="empty-state">No savings goals yet — add one to start tracking progress toward something specific.</div>' : ''}

        <div class="nwq-rows">
          ${data.map(g => goalCardHtml(g, networth)).join('')}
        </div>

        ${form ? goalFormHtml(form, networth) : '<button class="btn secondary" id="addGoalBtn" style="margin-top:12px">+ Add Goal</button>'}
      </div>
    `
    wire()
  }

  // onGoalsChanged's app-level render() rebuilds #app, but this overlay
  // lives on document.body (not #app) so it's unaffected — refresh() only
  // needs to pull the fresh data back and redraw itself.
  async function refresh() {
    data = await onGoalsChanged()
    render()
  }

  function wire() {
    overlay.onclick = e => { if (e.target === overlay) close() }

    overlay.querySelectorAll('.goal-edit').forEach(btn => {
      btn.onclick = () => {
        const g = data.find(x => x.id === btn.dataset.id)
        form = {
          id: g.id,
          name: g.name,
          target_amount: String(g.target_amount),
          target_date: g.target_date || '',
          current_amount: String(g.current_amount || 0),
          linked_account: g.linked_account || '',
          useLinkedAccount: !!g.linked_account,
        }
        render()
      }
    })
    overlay.querySelectorAll('.goal-delete').forEach(btn => {
      btn.onclick = async () => {
        const ok = await confirmDialog('Delete this goal?', 'Delete', true)
        if (!ok) return
        try {
          await deleteGoal(btn.dataset.id)
          toast('Goal deleted')
          await refresh()
        } catch (e) {
          toast(e.message || 'Failed to delete')
        }
      }
    })

    overlay.querySelector('#addGoalBtn')?.addEventListener('click', () => {
      form = { name: '', target_amount: '', target_date: '', current_amount: '0', linked_account: '', useLinkedAccount: false }
      render()
    })

    if (form) wireGoalForm()
  }

  function wireGoalForm() {
    overlay.querySelector('#goalName').oninput = e => { form.name = e.target.value }
    overlay.querySelector('#goalTarget').oninput = e => { form.target_amount = e.target.value }
    wireDmyDateField(overlay, 'goalDate', v => { form.target_date = v })
    overlay.querySelector('#goalUseLinked').onchange = e => { form.useLinkedAccount = e.target.checked; render() }
    overlay.querySelector('#goalLinkedAccount')?.addEventListener('change', e => { form.linked_account = e.target.value })
    overlay.querySelector('#goalCurrent')?.addEventListener('input', e => { form.current_amount = e.target.value })
    overlay.querySelector('#goalCancel').onclick = () => { form = null; render() }
    overlay.querySelector('#goalSave').onclick = async () => {
      const name = form.name.trim()
      const target = parseFloat(form.target_amount)
      if (!name) { toast('Enter a name'); return }
      if (!target || target <= 0) { toast('Enter a valid target amount'); return }
      if (form.useLinkedAccount && !form.linked_account) { toast('Pick an account'); return }

      const payload = {
        name,
        target_amount: target,
        target_date: form.target_date || null,
        current_amount: form.useLinkedAccount ? 0 : (parseFloat(form.current_amount) || 0),
        linked_account: form.useLinkedAccount ? form.linked_account : null,
      }

      const btn = overlay.querySelector('#goalSave')
      btn.disabled = true
      btn.textContent = 'Saving…'
      try {
        if (form.id) await updateGoal(form.id, payload)
        else await addGoal(payload)
        toast('Goal saved')
        form = null
        await refresh()
      } catch (e) {
        toast(e.message || 'Failed to save')
        btn.disabled = false
        btn.textContent = form.id ? 'Save Changes' : 'Add Goal'
      }
    }
  }

  function close() { overlay.remove() }

  render()
}

function goalCardHtml(g, networth) {
  const progress = goalProgress(g, networth)
  const barClass = progress.pct >= 100 ? '' : (progress.pct >= 80 ? 'warn' : '')
  const noteText = progress.pct >= 100
    ? '🎉 Goal reached'
    : progress.suggestedMonthly != null
      ? `~${formatMoney(progress.suggestedMonthly)}/mo to reach it by ${formatDateDMY(g.target_date)}`
      : g.target_date ? 'Target date has passed' : 'No target date set'

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="budget-row-top">
        <span class="cat">${escapeHtml(g.name)}</span>
        <span class="nums">${formatMoney(progress.current)} / ${formatMoney(progress.target)}</span>
      </div>
      <div class="budget-bar-track"><div class="budget-bar-fill ${barClass}" style="width:${progress.pct}%"></div></div>
      <div style="font-size:12px;color:var(--text2);margin-top:8px">
        ${noteText}${g.linked_account ? ` · linked to ${escapeHtml(g.linked_account)}` : ''}
      </div>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button class="btn secondary goal-edit" data-id="${g.id}" style="width:auto;padding:8px 14px;font-size:13px">Edit</button>
        <button class="btn danger goal-delete" data-id="${g.id}" style="width:auto;padding:8px 14px;font-size:13px">Delete</button>
      </div>
    </div>
  `
}

function goalFormHtml(form, networth) {
  const accounts = latestAccountValues(networth)
  return `
    <div class="card" style="margin-top:12px">
      <label style="margin-top:0">Name</label>
      <input id="goalName" type="text" placeholder="e.g. Condo Renovation" value="${escapeHtml(form.name)}" />

      <label>Target Amount</label>
      <input id="goalTarget" type="number" inputmode="decimal" placeholder="e.g. 300000" value="${escapeHtml(form.target_amount)}" />

      <label>Target Date (optional)</label>
      ${dmyDateFieldHtml('goalDate', form.target_date)}

      <label class="checkbox-row" style="margin-top:16px">
        <input type="checkbox" id="goalUseLinked" ${form.useLinkedAccount ? 'checked' : ''} />
        <span>Track progress from a net worth account</span>
      </label>

      ${form.useLinkedAccount ? `
        <label>Account</label>
        <select id="goalLinkedAccount">
          <option value="">Select an account…</option>
          ${accounts.map(a => `<option value="${escapeHtml(a.name)}" ${a.name === form.linked_account ? 'selected' : ''}>${escapeHtml(a.name)} (${formatMoney(a.value)})</option>`).join('')}
        </select>
      ` : `
        <label>Current Amount Saved</label>
        <input id="goalCurrent" type="number" inputmode="decimal" placeholder="0" value="${escapeHtml(form.current_amount)}" />
      `}

      <div class="confirm-actions" style="margin-top:16px">
        <button class="btn secondary" id="goalCancel">Cancel</button>
        <button class="btn" id="goalSave">${form.id ? 'Save Changes' : 'Add Goal'}</button>
      </div>
    </div>
  `
}
