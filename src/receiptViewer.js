import { icon } from './icons.js'
import { getReceiptUrl } from './supabase.js'
import { toast } from './helpers.js'

// Full-screen receipt photo with zoom: scroll wheel / pinch to zoom around
// the pointer, drag to pan, double-click / double-tap to toggle 1x ↔ 2.5x,
// plus +/−/reset buttons. Closes on Esc (main.js replays a backdrop click on
// the topmost .confirm-overlay), the ✕ button, or a click on the backdrop.
const MIN = 1
const MAX = 6

// Accepts a ready URL (object URL of a just-picked file, or an existing
// signed URL) or a storage path, which is resolved to a signed URL first.
export async function openReceiptViewer({ url, path }) {
  if (!url && path) {
    try { url = await getReceiptUrl(path) } catch (e) { toast(e.message || "Couldn't load the receipt"); return }
  }
  if (!url) return

  const overlay = document.createElement('div')
  overlay.className = 'confirm-overlay receipt-viewer'
  overlay.innerHTML = `
    <div class="rv-stage"><img class="rv-img" alt="Receipt" draggable="false" /></div>
    <div class="rv-tools">
      <button type="button" class="rv-btn" data-act="out" aria-label="Zoom out">${icon('minus', 18)}</button>
      <button type="button" class="rv-btn rv-pct" data-act="reset" aria-label="Reset zoom">100%</button>
      <button type="button" class="rv-btn" data-act="in" aria-label="Zoom in">${icon('plus', 18)}</button>
      <button type="button" class="rv-btn" data-act="close" aria-label="Close">${icon('x', 18)}</button>
    </div>
  `
  document.body.appendChild(overlay)
  const stage = overlay.querySelector('.rv-stage')
  const img = overlay.querySelector('.rv-img')
  const pct = overlay.querySelector('.rv-pct')
  img.src = url

  let scale = 1, x = 0, y = 0
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    pct.textContent = `${Math.round(scale * 100)}%`
    stage.classList.toggle('zoomed', scale > 1)
  }
  // keeps at least part of the photo on screen while panning
  const clamp = () => {
    if (scale <= 1) { x = 0; y = 0; return }
    const maxX = (img.offsetWidth * scale) / 2
    const maxY = (img.offsetHeight * scale) / 2
    x = Math.max(-maxX + 40, Math.min(maxX - 40, x))
    y = Math.max(-maxY + 40, Math.min(maxY - 40, y))
  }
  // zoom so the point under (cx, cy) stays put
  const zoomAt = (next, cx, cy) => {
    next = Math.min(MAX, Math.max(MIN, next))
    const r = stage.getBoundingClientRect()
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2)
    x = px - ((px - x) * next) / scale
    y = py - ((py - y) * next) / scale
    scale = next
    clamp(); apply()
  }
  const center = () => { const r = stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey) }
  overlay.onclick = (e) => { if (e.target === overlay || (e.target === stage && scale === 1)) close() }
  const onKey = (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(scale * 1.25, ...center())
    else if (e.key === '-') zoomAt(scale / 1.25, ...center())
    else if (e.key === '0') { scale = 1; clamp(); apply() }
  }
  document.addEventListener('keydown', onKey)

  overlay.querySelector('.rv-tools').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'in') zoomAt(scale * 1.5, ...center())
    else if (act === 'out') zoomAt(scale / 1.5, ...center())
    else if (act === 'reset') { scale = 1; clamp(); apply() }
    else if (act === 'close') close()
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomAt(scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
  }, { passive: false })

  stage.addEventListener('dblclick', (e) => {
    if (scale > 1) { scale = 1; clamp(); apply() } else zoomAt(2.5, e.clientX, e.clientY)
  })

  // pointer events cover mouse drag, one-finger pan and two-finger pinch
  const pointers = new Map()
  let pinchStart = null, lastTap = 0
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale }
    }
    if (e.pointerType === 'touch' && pointers.size === 1) {
      const now = Date.now()
      if (now - lastTap < 300) { if (scale > 1) { scale = 1; clamp(); apply() } else zoomAt(2.5, e.clientX, e.clientY) }
      lastTap = now
    }
  })
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()]
      zoomAt(pinchStart.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.dist), (a.x + b.x) / 2, (a.y + b.y) / 2)
    } else if (pointers.size === 1 && scale > 1) {
      x += e.clientX - prev.x
      y += e.clientY - prev.y
      clamp(); apply()
    }
  })
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null }
  stage.addEventListener('pointerup', up)
  stage.addEventListener('pointercancel', up)

  apply()
}

// One capture-phase listener for every 📎 badge (History lists on both
// platforms, Dashboard's recent table): it runs before the row's own click
// handler, so tapping the badge opens the photo instead of the edit form.
export function initReceiptBadges() {
  document.addEventListener('click', (e) => {
    const badge = e.target.closest?.('.receipt-open[data-receipt]')
    if (!badge) return
    e.stopPropagation()
    e.preventDefault()
    openReceiptViewer({ path: badge.dataset.receipt })
  }, true)
}
