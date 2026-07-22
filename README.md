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

## Address bar behavior

Raw address-bar input is normalized via `src/shared/url-utils.ts`:

- valid `http(s)` URL &rarr; used as-is
- bare domain (`example.com`) &rarr; `https://example.com`
- `localhost` / `localhost:3000` &rarr; `http://…`
- anything else &rarr; DuckDuckGo search

If no tab is open when you navigate, a guest tab is created automatically.

## Browser engine wiring (v0.3.0)

- **BrowserView bounds** are now computed from the live window content size, the
  reported chrome height and the sidebar width (`computeViewBounds`), and the
  view uses `setAutoResize`, so the page no longer overlaps the shell UI and
  follows window resizes. The renderer's reported chrome height is remembered
  and reused on every tab switch (no more hardcoded guess).
- **Electron 33 compatibility**: navigation uses the new
  `webContents.navigationHistory` API via `src/main/services/webcontents-utils.ts`
  (with a legacy fallback), removing deprecated `canGoBack()/goBack()` calls.
- **Navigation state**: back/forward/loading state is emitted on load start/stop
  and on `dom-ready`, with `canGoBack`/`canGoForward` included, so the toolbar
  buttons stay accurate.
- **Per-site status end-to-end**: after autofill (either via the sidebar or a
  new login tab) the main process emits `event:status-changed`; the renderer
  refreshes the sidebar for the current domain automatically.

## Testing & CI

Unit tests live in `tests/` and run with `tsx`:

```bash
for f in tests/*.test.ts; do npx tsx "$f"; done
```

Covers: domain utils, expiry logic, tab-selection dedup, URL/search
normalization, and the WebContents nav/bounds helpers. GitHub Actions:
`.github/workflows/build-exe.yml` packages the Windows `.exe`. A CI workflow
that type-checks + builds + runs tests on every push is provided in
`ci-templates/ci.yml` — copy it into `.github/workflows/` to enable (see
`ci-templates/README.md`; kept out of `.github/workflows/` because the push
token lacks the `workflows` permission).

## Status

- ✅ Full browser shell UI (top bar, bookmarks bar, sidebar, tab strip, content area)
- ✅ Renderer bundles and loads correctly
- ✅ Mock/placeholder fallback for offline/unwired runs
- ✅ Address-bar URL/search normalization (v0.2.0)
- ✅ Live BrowserView bounds (chrome height + sidebar aware) and Electron 33
  navigation API (v0.3.0)
- ✅ Per-site login status refreshed end-to-end after autofill (v0.3.0)
- ✅ CI workflow running type-checks, build and unit tests
- ⚠️ Remaining: exercise the full flow on a real Windows desktop (GUI can't run
  in CI/sandbox); optional migration from deprecated `BrowserView` to
  `WebContentsView`.
