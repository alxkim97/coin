# Coin

Desktop finance/crypto tracker (Vite + Electron, Supabase backend).

## npm Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (once, or after pulling changes) |
| `npm run dev` | Vite dev server — opens in the **browser**, hot reload |
| `npm run electron:dev` | Launch the **desktop app** in dev mode |
| `npm run build` | Build web assets only (no installer) |
| `npm run electron:build` | Build web assets + package a Windows installer |
| `npm run migrate` | Run the database migration script |

No `npm start` script — use `npm run dev` (browser) or `npm run electron:dev`
(desktop) instead. See the full
[npm cheat sheet](../NPM-CHEATSHEET.md) for how this compares to other
projects.

## Other docs

- [SUPABASE-SETUP.md](SUPABASE-SETUP.md) — Supabase configuration
