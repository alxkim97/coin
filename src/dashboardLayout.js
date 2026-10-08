const ORDER_KEY = 'coin_dash_order'
const COLLAPSED_KEY = 'coin_dash_collapsed'

export const DEFAULT_ORDER = ['suggestions', 'networth', 'goals', 'bills', 'streaks', 'budget', 'category', 'vendors']

// Lower-priority widgets collapsed by default on mobile only — leads the home
// screen with what's actionable (suggestions/net worth/bills/goals) instead
// of a long scroll; desktop has the room to show everything open. Only used
// to seed a true first run (see getCollapsed) — once someone has touched the
// toggle at all, their own saved set always wins over this default.
export const DEFAULT_COLLAPSED_MOBILE = ['streaks', 'vendors', 'budget']

export function getOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY))
    if (!Array.isArray(saved)) return [...DEFAULT_ORDER]
    // keep in sync if widgets are added/removed later — unknown ids dropped.
    // A newly-added widget is inserted at its DEFAULT_ORDER-relative position
    // (right after the nearest earlier id the user still has), not appended
    // to the end — DEFAULT_ORDER deliberately puts Net Worth/Streaks first,
    // and an existing user's saved 3-item order used to bury both new
    // widgets below the fold instead of respecting that.
    const known = saved.filter(id => DEFAULT_ORDER.includes(id))
    for (const id of DEFAULT_ORDER) {
      if (known.includes(id)) continue
      const defaultIndex = DEFAULT_ORDER.indexOf(id)
      let insertAt = 0
      for (let i = defaultIndex - 1; i >= 0; i--) {
        const anchorPos = known.indexOf(DEFAULT_ORDER[i])
        if (anchorPos !== -1) { insertAt = anchorPos + 1; break }
      }
      known.splice(insertAt, 0, id)
    }
    return known
  } catch {
    return [...DEFAULT_ORDER]
  }
}

export function setOrder(order) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order))
}

export function getCollapsed(isMobile = false) {
  const raw = localStorage.getItem(COLLAPSED_KEY)
  // Distinguish "never set" (seed a device-appropriate default) from
  // "explicitly set to []" (user expanded everything) — both must stay
  // distinct, or a user who deliberately expanded everything back out would
  // get re-collapsed on their next mobile visit.
  if (raw === null) return new Set(isMobile ? DEFAULT_COLLAPSED_MOBILE : [])
  try {
    const saved = JSON.parse(raw)
    return new Set(Array.isArray(saved) ? saved : [])
  } catch {
    return new Set()
  }
}

export function toggleCollapsed(id, isMobile = false) {
  const set = getCollapsed(isMobile)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
}
