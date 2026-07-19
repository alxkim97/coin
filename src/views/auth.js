import { signIn, signUp } from '../supabase.js'

export function renderAuth(container, { onSignedIn }) {
  let mode = 'signin'

  function draw() {
    container.innerHTML = `
      <div class="center-screen">
        <h1 style="text-align:center;font-size:28px;margin-bottom:4px">🪙 Coin</h1>
        <p style="text-align:center;color:var(--text2);margin-bottom:28px">
          ${mode === 'signin' ? 'Sign in to sync your transactions' : 'Create your account'}
        </p>
        <div class="card">
          <label>Email</label>
          <input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" />
          <label>Password</label>
          <input id="authPass" type="password" autocomplete="current-password" placeholder="••••••••" />
          <div class="field-error" id="authErr"></div>
          <div style="margin-top:16px">
            <button class="btn" id="authSubmit">${mode === 'signin' ? 'Sign In' : 'Create Account'}</button>
          </div>
        </div>
        <div style="text-align:center;margin-top:16px">
          <button class="link-btn" id="authToggle">
            ${mode === 'signin' ? "No account? Create one" : 'Already have one? Sign in'}
          </button>
        </div>
      </div>
    `
    container.querySelector('#authToggle').onclick = () => {
      mode = mode === 'signin' ? 'signup' : 'signin'
      draw()
    }
    container.querySelector('#authSubmit').onclick = submit
    container.querySelector('#authPass').addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
  }

  async function submit() {
    const email = container.querySelector('#authEmail').value.trim()
    const pass = container.querySelector('#authPass').value
    const err = container.querySelector('#authErr')
    const btn = container.querySelector('#authSubmit')
    err.textContent = ''
    if (!email || !pass) { err.textContent = 'Please fill in both fields.'; return }
    if (pass.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return }
    btn.disabled = true
    btn.textContent = 'Please wait…'
    try {
      if (mode === 'signup') {
        await signUp(email, pass)
        err.style.color = 'var(--green)'
        err.textContent = 'Account created! Check your email to confirm, then sign in.'
        mode = 'signin'
        setTimeout(draw, 1800)
      } else {
        await signIn(email, pass)
        onSignedIn()
      }
    } catch (e) {
      err.style.color = 'var(--red)'
      err.textContent = e.message || 'Something went wrong.'
      btn.disabled = false
      btn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account'
    }
  }

  draw()
}
