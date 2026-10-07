// Same breakpoint as style.css's desktop media query — kept in sync by hand,
// there's no single source of truth shared between CSS and JS here.
const DESKTOP_QUERY = '(min-width: 860px)'
let mql = null

export function isDesktopView() {
  if (!mql) mql = window.matchMedia(DESKTOP_QUERY)
  return mql.matches
}

export function onDesktopViewChange(cb) {
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', cb)
}
