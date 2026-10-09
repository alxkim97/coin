import { icon } from './icons.js'

// Phone pull-to-refresh: drag down from the very top of a page to refetch
// everything. A home-screen (standalone) app has no browser refresh gesture,
// so without this the only way to pick up entries logged on another device
// was to close and reopen Coin. `isEnabled` keeps it off wherever a refresh
// would throw away something half-typed (Add, Budget's edit mode) or fight
// another gesture (Customize's drag-to-reorder).
const THRESHOLD = 70 // px of (damped) pull before letting go refreshes
const MAX = 110

export function setupPullToRefresh({ onRefresh, isEnabled }) {
  const ind = document.createElement('div')
  ind.className = 'ptr'
  ind.innerHTML = icon('repeat', 18)
  document.body.appendChild(ind)

  let startY = null
  let pull = 0
  let busy = false

  const place = () => {
    ind.style.transform = `translate(-50%, ${pull - 44}px) rotate(${pull * 3}deg)`
    ind.style.opacity = String(Math.min(1, pull / THRESHOLD))
    ind.classList.toggle('ready', pull >= THRESHOLD)
  }
  const reset = () => { pull = 0; startY = null; ind.classList.remove('ready', 'spinning'); ind.style.opacity = '0'; ind.style.transform = 'translate(-50%, -44px)' }

  document.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || !isEnabled()) return
    if (document.querySelector('.confirm-overlay')) return // a popup is open
    startY = e.touches[0].clientY
  }, { passive: true })

  document.addEventListener('touchmove', (e) => {
    if (startY === null) return
    const dy = e.touches[0].clientY - startY
    if (dy <= 0 || window.scrollY > 0) { if (pull) { pull = 0; place() }; return }
    pull = Math.min(MAX, dy * 0.5)
    place()
  }, { passive: true })

  document.addEventListener('touchend', async () => {
    if (startY === null) return
    if (pull < THRESHOLD) { reset(); return }
    busy = true
    startY = null
    pull = THRESHOLD
    place()
    ind.classList.add('spinning')
    try { await onRefresh() } finally { busy = false; reset() }
  })
  reset()
}
