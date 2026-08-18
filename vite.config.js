import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig({
  // Relative asset paths — Vercel resolves them fine from '/', and it's what
  // lets the Electron build load dist/index.html straight off disk (file://
  // can't resolve root-absolute '/assets/...' paths).
  base: './',
  // Exposed in-app (tabbar footer) so it's obvious whether a deploy landed,
  // instead of guessing from PWA/service-worker cache behavior.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true, // expose on LAN so it's reachable from your phone during dev
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Coin — Finance Tracker',
        short_name: 'Coin',
        description: 'A simple personal finance tracker',
        theme_color: '#2563eb',
        background_color: '#0f1115',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
    }),
  ],
})
