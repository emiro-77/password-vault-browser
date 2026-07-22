# Password Vault Browser

A privacy-focused, multi-session desktop browser (Electron) with isolated tabs
and **global** credential management. Login entries are global app records;
per-site login *status* is tracked separately.

## Architecture

- **Main process** (`src/main`) — Electron entry, DB (better-sqlite3), credential
  store, tab/session managers, and IPC handlers. Manages `BrowserView`s directly.
- **Preload** (`src/preload`) — exposes a typed, sandboxed `window.pvbAPI` via
  `contextBridge`.
- **Renderer** (`src/renderer`) — React browser shell UI:
  - `components/AddressBar.tsx` — back / forward / refresh / URL input / new tab
  - `components/BookmarksBar.tsx` — bookmarks bar
  - `components/Sidebar.tsx` — saved login entries (label, username/email,
    per-site status badge)
  - `components/TabStrip.tsx` — visible, switchable tabs + new-tab button
  - `App.tsx` — composes the shell and coordinates tabs/navigation via IPC

## Build & run

```bash
npm install
npm run build      # builds main, preload, and the bundled renderer
npm start          # launch Electron
npm run dist:portable   # build the Windows portable .exe
```

### Renderer build note (important)

The renderer is React/TSX and **must be bundled** into a single
`dist/renderer/renderer.js` (that is the file `src/renderer/index.html`
references). Plain `tsc` only emits separate ES modules with unresolved bare
imports (`react`, `react-dom/client`), which the Electron renderer cannot load —
that produced a blank window with no shell UI.

`npm run build:renderer` now runs `scripts/build-renderer.js` (esbuild), which
bundles React + all components into one self-contained IIFE. Type-checking the
renderer separately: `npm run typecheck:renderer`.

## Placeholder mode

If `window.pvbAPI` is unavailable (preload didn't run, or the browser-engine /
IPC layer isn't wired yet), the renderer falls back to an in-memory **mock API**
(`src/renderer/api.ts`) so the full shell still renders with placeholder login
entries and bookmarks. A yellow banner indicates placeholder mode.

## Product model

- **Login entries** are global records (id, label, username/email). Passwords
  are stored main-process-side only and never sent to the renderer.
- **Per-site login status** is a separate record keyed by `(loginEntryId, domain)`.
- Credentials are **not** modeled as per-site records.

## Status

- ✅ Full browser shell UI (top bar, bookmarks bar, sidebar, tab strip, content area)
- ✅ Renderer now bundles and loads correctly
- ✅ Mock/placeholder fallback for offline/unwired runs
- ⚠️ Remaining: verify live `BrowserView` attach/detach bounds against the shell
  chrome height on Windows; real per-site status wiring end-to-end.
