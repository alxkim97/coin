// Electron loads the packaged app via file://, so a relative fetch('/api/...')
// has nowhere to resolve to — it only works in the Vercel-hosted PWA. Point
// the desktop build at the deployed domain instead.
export const API_BASE = window.electronAPI?.isElectron ? 'https://alexkimcoin.vercel.app/api' : '/api'
