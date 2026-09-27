import { precacheAndRoute } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)

// Replicates what the old generateSW config's skipWaiting/clientsClaim
// options did automatically — injectManifest hands the rest of the file to
// us, so this needs doing by hand. Without it, a new service worker installs
// but waits for every open tab to fully close before taking over, so a
// refresh alone kept serving the old cached bundle after a deploy.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Budget threshold alerts — api/check-budget-alerts.js sends these via
// web-push. Same push/notificationclick shape as WalkLog's service worker.
self.addEventListener('push', (event) => {
  let data = { title: 'Coin', body: 'A budget category needs your attention.' }
  try {
    if (event.data) data = event.data.json()
  } catch {
    // non-JSON payload — fall back to the default above rather than throw
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png' }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})
