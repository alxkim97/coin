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
  // Libraries in their own long-lived files: they rarely change, so after a
  // deploy the PWA only re-downloads Coin's own code, not ~450 kB of
  // Chart.js/Supabase it already has cached.
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/](chart\.js|@kurkle)/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  server: {
    host: true, // expose on LAN so it's reachable from your phone during dev
    // electron-builder writes temp files into release/ while packaging — the
    // dev server's watcher crashed on one (EPERM), so leave build output alone
    watch: { ignored: ['**/release/**', '**/dist/**'] },
  },
  plugins: [
    VitePWA({
      // Switched from the default generateSW to injectManifest so src/sw.js
      // can add its own push/notificationclick handlers (budget alerts) —
      // generateSW auto-writes the whole service worker and leaves no room
      // for custom event listeners. injectManifest just precaches the same
      // way and hands the rest of the file to us.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-maskable-512.png'],
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
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      },
    }),
  ],
})
