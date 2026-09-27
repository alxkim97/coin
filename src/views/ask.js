import { escapeHtml } from '../helpers.js'
import { askQuestion } from '../aiAsk.js'

// Persists across tab switches within the session (module-level, same idiom
// as transactions.js's filters) — losing the thread every time you leave the
// tab would make follow-up questions painful.
let messages = []
let pending = false
let draft = ''

export function renderAsk(container, { txns, budgets, networth, session }) {
  container.innerHTML = `
    <div class="top-bar"><h1>Ask</h1></div>
    <div class="ask-thread">
      ${messages.length === 0
        ? '<div class="empty-state">Ask anything about your spending, budgets, or net worth — e.g. "How much did I spend on Food last month?"</div>'
        : messages.map(m => `
          <div class="ask-msg ask-msg-${m.role}">
            <div class="ask-msg-bubble${m.error ? ' ask-msg-error' : ''}">${escapeHtml(m.text)}</div>
          </div>
        `).join('')}
      ${pending ? '<div class="ask-msg ask-msg-assistant"><div class="ask-msg-bubble ask-msg-pending">Thinking…</div></div>' : ''}
    </div>
    <div class="ask-input-row">
      <input id="askInput" type="text" placeholder="Ask a question…" value="${escapeHtml(draft)}" ${pending ? 'disabled' : ''} />
      <button class="btn" id="askSend" ${pending ? 'disabled' : ''}>Ask</button>
    </div>
  `

  container.scrollTop = container.scrollHeight

  const input = container.querySelector('#askInput')
  input.oninput = e => { draft = e.target.value }
  input.onkeydown = e => { if (e.key === 'Enter' && !pending) send() }
  container.querySelector('#askSend').onclick = send
  if (!pending) input.focus()

  async function send() {
    const question = draft.trim()
    if (!question || pending) return
    messages.push({ role: 'user', text: question })
    draft = ''
    pending = true
    renderAsk(container, { txns, budgets, networth, session })

    try {
      const answer = await askQuestion({ question, txns, budgets, networth, session })
      messages.push({ role: 'assistant', text: answer })
    } catch (e) {
      messages.push({ role: 'assistant', text: e.message || 'Something went wrong — try again.', error: true })
    }
    pending = false
    renderAsk(container, { txns, budgets, networth, session })
  }
}
