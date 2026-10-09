// Desktop Tax Calculator (new) — a port of Ledger's Thai personal income tax
// estimate (ภาษีเงินได้บุคคลธรรมดา, tax year 2568 rules, same caps and
// brackets). Recalculates as you type; inputs are remembered on this device
// only (localStorage) — it's a what-if tool, not account data.
import { formatMoney, escapeHtml } from '../helpers.js'
import { icon } from '../icons.js'
import { headHtml, cardHtml } from './ui.js'

const KEY = 'coin_tax_inputs'
const BRACKETS = [
  { from: 0, to: 150000, rate: 0 },
  { from: 150000, to: 300000, rate: 0.05 },
  { from: 300000, to: 500000, rate: 0.10 },
  { from: 500000, to: 750000, rate: 0.15 },
  { from: 750000, to: 1000000, rate: 0.20 },
  { from: 1000000, to: 2000000, rate: 0.25 },
  { from: 2000000, to: 5000000, rate: 0.30 },
  { from: 5000000, to: Infinity, rate: 0.35 },
]

const SECTIONS = [
  { title: 'Income (เงินได้)', icon: 'dollar', fields: [
    { id: 'salary', label: 'Monthly salary (฿)', hint: 'Section 40(1) employment income' },
    { id: 'months', label: 'Months employed', hint: 'Months in the tax year', def: 12 },
    { id: 'bonus', label: 'Bonus / other income (฿)', hint: 'One-off payments, overtime, etc.' },
  ] },
  { title: 'Core deductions (ค่าลดหย่อนพื้นฐาน)', icon: 'gift', fields: [
    { id: 'sso', label: 'Social security paid (฿)', hint: 'Max ฿9,000/yr (5% of salary, cap ฿750/mo)', def: 9000 },
    { id: 'spouse', label: 'Spouse allowance (฿)', hint: '฿60,000 if married and spouse has no income' },
    { id: 'children', label: 'Children (จำนวนบุตร)', hint: '฿30,000 for the 1st, ฿60,000 each from the 2nd' },
    { id: 'parents', label: 'Parent allowance (฿)', hint: '฿30,000 per parent (60+, income ≤ ฿30,000)' },
  ] },
  { title: 'Insurance & retirement (ประกันและกองทุน)', icon: 'shield', fields: [
    { id: 'life', label: 'Life insurance premium (฿)', hint: 'Max ฿100,000; policy term ≥ 10 years' },
    { id: 'health', label: 'Health insurance premium (฿)', hint: 'Max ฿25,000; with life ≤ ฿100,000 total' },
    { id: 'parentIns', label: 'Parents’ health insurance (฿)', hint: 'Max ฿15,000' },
    { id: 'pvd', label: 'Provident fund (฿)', hint: 'Max 15% of income; retirement group ≤ ฿500,000' },
    { id: 'rmf', label: 'RMF (฿)', hint: 'Max 30% of income; retirement group ≤ ฿500,000' },
    { id: 'thaiesg', label: 'Thai ESG fund (฿)', hint: 'Max 30% of income, ฿300,000' },
  ] },
  { title: 'Special 2568 measures (มาตรการพิเศษ)', icon: 'star', fields: [
    { id: 'ereceipt', label: 'Easy E-Receipt 2.0 (฿)', hint: 'Max ฿50,000 (e-Tax invoices, 16 Jan–28 Feb)' },
    { id: 'travel', label: 'Domestic travel — เที่ยวดีมีคืน (฿)', hint: 'Max ฿20,000 (฿30,000 secondary provinces)' },
    { id: 'mortgage', label: 'Home loan interest (฿)', hint: 'Actual paid, max ฿100,000' },
    { id: 'donation', label: 'General donations (฿)', hint: 'Max 10% of net income after other deductions' },
  ] },
]

function loadInputs(txns) {
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {} } catch { /* start fresh */ }
  const v = {}
  for (const s of SECTIONS) for (const f of s.fields) v[f.id] = saved[f.id] ?? f.def ?? 0
  if (saved.salary === undefined) v.salary = typicalSalary(txns)
  return v
}

// first-visit default: the most common monthly Salary total you've logged
function typicalSalary(txns) {
  const byMonth = {}
  for (const t of txns) if (t.type === 'income' && t.category === 'Salary') byMonth[t.date.slice(0, 7)] = (byMonth[t.date.slice(0, 7)] || 0) + Number(t.amount)
  const vals = Object.values(byMonth).map(Math.round)
  if (!vals.length) return 0
  const counts = {}
  for (const x of vals) counts[x] = (counts[x] || 0) + 1
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0])
}

export function computeTax(v) {
  const gross = v.salary * v.months + v.bonus
  const expDed = Math.min(gross * 0.5, 100000)
  const personal = 60000
  const sso = Math.min(v.sso, 9000)
  let childAllow = 0
  for (let c = 1; c <= Math.floor(v.children); c++) childAllow += c === 1 ? 30000 : 60000
  const insTotal = Math.min(Math.min(v.life, 100000) + Math.min(v.health, 25000), 100000)
  const parentIns = Math.min(v.parentIns, 15000)
  const pvdCap = Math.min(v.pvd, Math.min(gross * 0.15, 500000))
  const rmfCap = Math.min(v.rmf, Math.min(gross * 0.30, 500000))
  const retirement = Math.min(pvdCap + rmfCap, 500000)
  const thaiesg = Math.min(v.thaiesg, Math.min(gross * 0.30, 300000))
  const ereceipt = Math.min(v.ereceipt, 50000)
  const travel = Math.min(v.travel, 30000)
  const mortgage = Math.min(v.mortgage, 100000)
  const allowances = personal + sso + v.spouse + childAllow + v.parents + insTotal + parentIns + retirement + thaiesg + ereceipt + travel + mortgage
  const beforeDonation = Math.max(0, gross - expDed - allowances)
  const donationDed = Math.min(v.donation, beforeDonation * 0.10)
  const net = Math.max(0, beforeDonation - donationDed)
  let tax = 0, remaining = net
  const brackets = []
  for (const b of BRACKETS) {
    const taxable = Math.min(Math.max(0, remaining), b.to - b.from)
    const t = taxable * b.rate
    tax += t
    brackets.push({ ...b, taxable, tax: t })
    remaining -= taxable
  }
  return { gross, expDed, allowances, donationDed, net, tax, brackets, monthly: tax / 12, rate: gross > 0 ? tax / gross : 0, takeHome: v.salary - tax / 12 - (Math.min(v.sso, 9000) / 12 || 750) }
}

const fmtK = n => n === Infinity ? '∞' : n >= 1e6 ? n / 1e6 + 'M' : n >= 1e3 ? n / 1e3 + 'k' : String(n)

export function renderTaxDesktop(container, { txns }) {
  const v = loadInputs(txns)
  container.innerHTML = `
    ${headHtml('Tax Calculator', 'ภาษีเงินได้บุคคลธรรมดา · tax year 2568 (2025) rules · an estimate, not a filing', '<span class="d-list-meta">Source: กรมสรรพากร (rd.go.th) · iTAX · KBank</span>')}
    <div class="d-tax">
      <div class="d-tax-inputs">
        ${SECTIONS.map(s => cardHtml({
          title: s.title, icon: s.icon,
          body: `<div class="d-fields">${s.fields.map(f => `
            <div class="d-field">
              <label for="t-${f.id}">${f.label}</label>
              <input id="t-${f.id}" class="mono tIn" data-id="${f.id}" type="number" min="0" step="${f.id === 'months' || f.id === 'children' ? 1 : 100}" value="${escapeHtml(String(v[f.id]))}" />
              <div class="hint">${f.hint}</div>
            </div>`).join('')}</div>`,
        })).join('')}
        <button class="d-link" id="tReset" style="align-self:flex-start">Reset all fields</button>
      </div>
      <div class="d-tax-result" id="tResult"></div>
    </div>
  `

  const draw = () => {
    const r = computeTax(v)
    container.querySelector('#tResult').innerHTML = cardHtml({
      title: 'Tax summary', icon: 'fileText',
      body: `
        <div class="d-res-row"><span class="l">Annual gross income</span><span class="v">${formatMoney(Math.round(r.gross))}</span></div>
        <div class="d-res-row"><span class="l">− Expense deduction <span class="d-list-meta">50%, max ฿100k</span></span><span class="v green">−${formatMoney(Math.round(r.expDed))}</span></div>
        <div class="d-res-row"><span class="l">− Allowances &amp; deductions</span><span class="v green">−${formatMoney(Math.round(r.allowances + r.donationDed))}</span></div>
        <div class="d-res-row total"><span class="l">= Net taxable income</span><span class="v big">${formatMoney(Math.round(r.net))}</span></div>
        <table class="d-table d-tax-brackets">
          <thead><tr><th>Bracket</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">Tax</th></tr></thead>
          <tbody>${r.brackets.map(b => `<tr class="${b.taxable > 0 ? 'on' : 'off'}"><td class="mono">${b.to === Infinity ? 'Over ' + fmtK(b.from) : fmtK(b.from) + '–' + fmtK(b.to)}</td><td class="r mono">${b.rate * 100}%</td><td class="r mono">${b.taxable ? formatMoney(Math.round(b.taxable)) : '—'}</td><td class="r mono">${b.tax ? formatMoney(Math.round(b.tax)) : '—'}</td></tr>`).join('')}</tbody>
        </table>
        <div class="d-res-row total"><span class="l">Annual income tax</span><span class="v neg" style="font-size:18px">${formatMoney(Math.round(r.tax))}</span></div>
        <div class="d-res-row"><span class="l">Monthly withholding (ภาษีหัก ณ ที่จ่าย)</span><span class="v"><span class="d-pill warn">${formatMoney(Math.round(r.monthly))}/mo</span></span></div>
        <div class="d-res-row"><span class="l">Effective tax rate</span><span class="v">${(r.rate * 100).toFixed(2)}%</span></div>
        <div class="d-res-row"><span class="l">Monthly take-home <span class="d-list-meta">after tax + SSO</span></span><span class="v green">${formatMoney(Math.round(r.takeHome))}</span></div>
        <div class="d-note" style="margin-top:12px">An estimate from กรมสรรพากร's published rules for ปีภาษี 2568 — check with the Revenue Department or a tax adviser before filing.</div>`,
    })
  }

  container.querySelectorAll('.tIn').forEach(inp => {
    inp.oninput = () => {
      v[inp.dataset.id] = Math.max(0, Number(inp.value) || 0)
      try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* not remembered this session */ }
      draw()
    }
  })
  container.querySelector('#tReset').onclick = () => {
    try { localStorage.removeItem(KEY) } catch { /* nothing saved */ }
    renderTaxDesktop(container, { txns })
  }
  draw()
}
