import { createClient } from '@supabase/supabase-js'

// Coin's package.json has "type": "module", so this file (unlike WalkLog's
// CommonJS api/send-reminder.js) is loaded as ESM by Vercel's Node runtime —
// export default, not module.exports.

const SUPA_URL = 'https://jpsisvaprkrcyvwnmasb.supabase.co'
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwc2lzdmFwcmtyY3l2d25tYXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM3NDgsImV4cCI6MjA5MzQ3OTc0OH0.Q7kmjiYSayzFJkjH42RoEXhbr9hjI9lXaDmX5Es4D4M'

const MAX_QUESTION_LEN = 1000
const MAX_CONTEXT_LEN = 24000

const SYSTEM_PROMPT = `You are the built-in finance assistant inside Coin, a personal finance tracker. Answer the user's question using ONLY the data given below in <context> — it's a digest of their real transactions, budgets, and net worth, already prepared for you. Amounts are in Thai baht (฿). Be direct and concise (a few sentences, or a short list — no filler). If the context doesn't contain enough information to answer confidently, say so plainly instead of guessing.`

function setCors(res) {
  // Electron's renderer loads the app over file://, which sends Origin: null —
  // a specific allow-list wouldn't work there, and the real access control is
  // the Supabase session check below, not CORS.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY not set' }); return }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) { res.status(401).json({ error: 'missing session' }); return }

  const supa = createClient(SUPA_URL, SUPA_ANON_KEY)
  const { data: { user }, error: authError } = await supa.auth.getUser(token)
  if (authError || !user) { res.status(401).json({ error: 'invalid session' }); return }

  const { question, context } = req.body || {}
  if (typeof question !== 'string' || !question.trim()) { res.status(400).json({ error: 'question is required' }); return }
  if (question.length > MAX_QUESTION_LEN) { res.status(400).json({ error: 'question too long' }); return }
  if (typeof context !== 'string' || context.length > MAX_CONTEXT_LEN) { res.status(400).json({ error: 'context missing or too long' }); return }

  let completion
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n<context>\n${context}\n</context>` },
          { role: 'user', content: question },
        ],
        temperature: 0.2,
      }),
    })
    if (!openaiRes.ok) {
      const detail = await openaiRes.text()
      console.error('OpenAI error', openaiRes.status, detail)
      res.status(502).json({ error: 'AI request failed' })
      return
    }
    completion = await openaiRes.json()
  } catch (e) {
    console.error('OpenAI request threw', e)
    res.status(502).json({ error: 'AI request failed' })
    return
  }

  const answer = completion?.choices?.[0]?.message?.content?.trim()
  if (!answer) { res.status(502).json({ error: 'AI returned no answer' }); return }

  res.status(200).json({ answer })
}
