# Password Vault Browser

A privacy-focused, multi-session desktop browser (Electron) with isolated tabs
and **per-site** credential management. Each login entry belongs to a specific
site (domain), and per-site login *status* is tracked for each site.

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

- **Login entries are per-site** (id, label, username/email, **domain**).
  Each account is saved for a specific website; the sidebar for a given site
  only shows that site's accounts (plus any legacy unscoped accounts whose
  `domain` is `''`). Passwords are stored main-process-side only and never sent
  to the renderer.
- **Duplicate prevention** — you cannot save two accounts with the same
  username/email on the same domain (enforced in `login-entry-manager.create`
  and by a unique DB index on `(domain, username_or_email)`). The modal shows
  the rejection message.
- **Per-site login status** is a separate record keyed by `(loginEntryId, domain)`.

### Modal / BrowserView layering

A loaded page is rendered by a native Electron `BrowserView`, which sits **above**
all shell HTML regardless of CSS `z-index`. To make the "Add Login Entry" modal
visible and interactive on top of a page, the renderer calls
`pvbAPI.tabs.setOverlay(true)` when the modal opens (main process detaches the
active `BrowserView` via `removeBrowserView`) and `setOverlay(false)` on
close/save (reattaches it). This is what fixes the "can't type / click in the
modal" and "no modal appears over a web page" issues.

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

## Troubleshooting

### "Placeholder mode" banner / websites don't load

Placeholder mode means the preload script did not load, so `window.pvbAPI` is
undefined and the UI falls back to in-memory mock data — navigation does
nothing and no page (not even DuckDuckGo) opens.

Causes and fixes:

1. **Stale/missing build.** `npm start` runs `electron .` without building.
   Always build first (or use `npm run dev`, which builds then starts):
   ```cmd
   npm run build
   npm start
   ```
   Confirm `dist\preload\index.js` exists afterwards.

2. **Sandboxed preload importing a local module (fixed in v0.3.1).** The main
   window uses `sandbox: true`; a sandboxed preload may only `require('electron')`
   and Node built-ins, never local project files. The preload previously did
   `require('../shared/types')`, which threw and prevented `window.pvbAPI` from
   being exposed. The channel constants are now inlined in `src/preload/index.ts`
   (kept in sync with `src/shared/types.ts` by `tests/ipc-channels-sync.test.ts`).

3. **See the real error.** The app now opens DevTools automatically when not
   packaged (or set `PVB_DEVTOOLS=1`), and logs `PRELOAD FAILED ...` to the
   terminal via the `preload-error` event. Check the DevTools Console for the
   exact cause.

### "Electron failed to install correctly"

The Electron binary was not downloaded (skipped scripts, proxy/firewall, or a
`node_modules` copied from another OS). Reinstall on the target machine:
```cmd
rmdir /s /q node_modules
del package-lock.json
npm install
```
Behind a proxy, set `ELECTRON_MIRROR` or the proxy env vars before installing.

## Status

- ✅ Full browser shell UI (top bar, bookmarks bar, sidebar, tab strip, content area)
- ✅ Renderer bundles and loads correctly
- ✅ Mock/placeholder fallback for offline/unwired runs
- ✅ Address-bar URL/search normalization (v0.2.0)
- ✅ Live BrowserView bounds (chrome height + sidebar aware) and Electron 33
  navigation API (v0.3.0)
- ✅ Per-site login status refreshed end-to-end after autofill (v0.3.0)
- ✅ Sandbox-safe preload so `window.pvbAPI` loads and real browsing works —
  fixes the "placeholder mode / pages don't load" issue (v0.3.1)
- ✅ Modal now renders on top of loaded pages (BrowserView detach/reattach via
  `tabs.setOverlay`) so its inputs and Cancel/Add buttons work (v0.3.2, fixes #1/#2)
- ✅ Per-site accounts: sidebar and "add account" are scoped to the current site;
  duplicate username/email on the same site is rejected (v0.3.2, fixes #1/#3)
- ✅ CI workflow running type-checks, build and unit tests
- ⚠️ Remaining: exercise the full flow on a real Windows desktop (GUI can't run
  in CI/sandbox); optional migration from deprecated `BrowserView` to
  `WebContentsView`.
