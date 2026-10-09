// Show a new deploy on the first open instead of the second.
//
// sw.js already does skipWaiting + clients.claim, so a freshly downloaded
// service worker takes control of the open page within seconds of launch —
// but the page itself keeps running the old bundle it booted with until the
// next launch. Reloading on `controllerchange` closes that gap.
//
// Guards: never on first install (no previous controller = nothing stale),
// at most once per minute (no reload loops), and never while the Add/edit
// form is open — then it waits until the app is next hidden (you
// switch away), so nothing in progress is lost.
const RELOAD_KEY = 'coin_sw_reloaded_at'
const CHECK_EVERY_MS = 60 * 60 * 1000 // long-open desktop windows also look for updates hourly

export function initUpdateReload({ isBusy }) {
  if (!('serviceWorker' in navigator)) return // Electron (file://) and old browsers
  let hadController = !!navigator.serviceWorker.controller
  let pending = false

  const reload = () => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last < 60 * 1000) return
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch { /* storage blocked — the controllerchange guard below still prevents loops */ }
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return } // first install, page is already current
    if (isBusy()) { pending = true; return }
    reload()
  })

  document.addEventListener('visibilitychange', () => {
    if (pending && document.visibilityState === 'hidden') reload()
  })

  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) setInterval(() => reg.update().catch(() => {}), CHECK_EVERY_MS)
  }).catch(() => {})
}
