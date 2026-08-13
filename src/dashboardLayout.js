const ORDER_KEY = 'coin_dash_order'
const COLLAPSED_KEY = 'coin_dash_collapsed'

export const DEFAULT_ORDER = ['networth', 'streaks', 'budget', 'category', 'vendors']

export function getOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY))
    if (!Array.isArray(saved)) return [...DEFAULT_ORDER]
    // keep in sync if widgets are added/removed later — unknown ids dropped, missing ids appended
    const known = saved.filter(id => DEFAULT_ORDER.includes(id))
    DEFAULT_ORDER.forEach(id => { if (!known.includes(id)) known.push(id) })
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
