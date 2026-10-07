const ORDER_KEY = 'coin_dash_order'
const COLLAPSED_KEY = 'coin_dash_collapsed'

export const DEFAULT_ORDER = ['suggestions', 'networth', 'goals', 'bills', 'streaks', 'budget', 'category', 'vendors']

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

export function getCollapsed() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY))
    return new Set(Array.isArray(saved) ? saved : [])
  } catch {
    return new Set()
  }
}

export function toggleCollapsed(id) {
  const set = getCollapsed()
  if (set.has(id)) set.delete(id)
  else set.add(id)
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
}
