import { addGoal, updateGoal, deleteGoal } from '../supabase.js'
import { goalProgress, latestAccountValues } from '../analysisData.js'
import { formatMoney, formatDateDMY, toast, confirmDialog, escapeHtml, dmyDateFieldHtml, wireDmyDateField } from '../helpers.js'

// Form state for the add/edit card — persists across the recursive
// re-renders this file does after every small change, same pattern as
// settings.js's recurringForm/networthForm.
let goalForm = null

export function renderGoals(container, opts) {
  const { goals, networth, onBack, onGoalsChanged } = opts

  container.innerHTML = `
    <button class="link-btn" id="goalsBack" style="margin-bottom:8px">‹ Back to Settings</button>
    <div class="top-bar"><h1>Goals</h1></div>

    ${goals.length === 0 && !goalForm ? '<div class="empty-state">No savings goals yet — add one to start tracking progress toward something specific.</div>' : ''}

    <div id="goalsList">
      ${goals.map(g => goalCardHtml(g, networth)).join('')}
    </div>

    ${goalForm ? goalFormHtml(goalForm, networth) : '<button class="btn secondary" id="addGoalBtn" style="margin-top:12px">+ Add Goal</button>'}
  `

  container.querySelector('#goalsBack').onclick = onBack

  container.querySelectorAll('.goal-edit').forEach(btn => {
    btn.onclick = () => {
      const g = goals.find(x => x.id === btn.dataset.id)
      goalForm = {
        id: g.id,
        name: g.name,
        target_amount: String(g.target_amount),
        target_date: g.target_date || '',
        current_amount: String(g.current_amount || 0),
        linked_account: g.linked_account || '',
        useLinkedAccount: !!g.linked_account,
      }
      renderGoals(container, opts)
    }
  })
  container.querySelectorAll('.goal-delete').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmDialog('Delete this goal?', 'Delete', true)
      if (!ok) return
      try {
        await deleteGoal(btn.dataset.id)
        toast('Goal deleted')
        await onGoalsChanged()
      } catch (e) {
        toast(e.message || 'Failed to delete')
      }
    }
  })

  container.querySelector('#addGoalBtn')?.addEventListener('click', () => {
    goalForm = { name: '', target_amount: '', target_date: '', current_amount: '0', linked_account: '', useLinkedAccount: false }
    renderGoals(container, opts)
  })

  if (goalForm) wireGoalForm(container, opts)
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

function wireGoalForm(container, opts) {
  container.querySelector('#goalName').oninput = e => { goalForm.name = e.target.value }
  container.querySelector('#goalTarget').oninput = e => { goalForm.target_amount = e.target.value }
  wireDmyDateField(container, 'goalDate', v => { goalForm.target_date = v })
  container.querySelector('#goalUseLinked').onchange = e => { goalForm.useLinkedAccount = e.target.checked; renderGoals(container, opts) }
  container.querySelector('#goalLinkedAccount')?.addEventListener('change', e => { goalForm.linked_account = e.target.value })
  container.querySelector('#goalCurrent')?.addEventListener('input', e => { goalForm.current_amount = e.target.value })
  container.querySelector('#goalCancel').onclick = () => { goalForm = null; renderGoals(container, opts) }
  container.querySelector('#goalSave').onclick = async () => {
    const name = goalForm.name.trim()
    const target = parseFloat(goalForm.target_amount)
    if (!name) { toast('Enter a name'); return }
    if (!target || target <= 0) { toast('Enter a valid target amount'); return }
    if (goalForm.useLinkedAccount && !goalForm.linked_account) { toast('Pick an account'); return }

    const payload = {
      name,
      target_amount: target,
      target_date: goalForm.target_date || null,
      current_amount: goalForm.useLinkedAccount ? 0 : (parseFloat(goalForm.current_amount) || 0),
      linked_account: goalForm.useLinkedAccount ? goalForm.linked_account : null,
    }

    const btn = container.querySelector('#goalSave')
    btn.disabled = true
    btn.textContent = 'Saving…'
    try {
      if (goalForm.id) await updateGoal(goalForm.id, payload)
      else await addGoal(payload)
      toast('Goal saved')
      goalForm = null
      await opts.onGoalsChanged()
    } catch (e) {
      toast(e.message || 'Failed to save')
      btn.disabled = false
      btn.textContent = goalForm.id ? 'Save Changes' : 'Add Goal'
    }
  }
}
