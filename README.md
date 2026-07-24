# Vault Browser Desktop

A privacy-focused, multi-session desktop browser (Electron) with isolated tabs
and **per-site** credential management. Each login entry belongs to a specific
site (domain), and per-site login *status* is tracked for each site.

## Architecture

- **Main process** (`src/main`) — Electron entry, DB (better-sqlite3), credential
  store, tab/session managers, and IPC handlers. Manages `BrowserView`s directly.
- **Preload** (`src/preload`) — exposes a typed, sandboxed `window.pvbAPI` via
  `contextBridge`.
- **Renderer** (`src/renderer`) — React browser shell UI:
  - `components/AddressBar.tsx` — back / forward / refresh / URL input,
    bookmark star, the **app logo** (theme-aware), and the **light/night theme toggle**
  - `components/ThemeToggle.tsx` — sun/moon button that flips the whole UI theme
  - `components/BookmarksBar.tsx` — bookmarks bar
  - `components/Sidebar.tsx` — saved login entries (label, username/email,
    per-site status badge, per-entry delete button with confirm modal), a
    **collapse/minimize arrow**, and a **category bar** (create/select/edit/delete)
  - `components/CategoryModal.tsx` — create/edit a category (name, icon picker +
    custom upload, Global/Private scope, account checklist)
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

## Theme, sidebar collapse & categories (v0.4.0)

### Light / Night theme toggle (Feature 1)

- Night mode is the default. The theme toggle (☀️/🌙) lives in the address bar's
  right-hand cluster, next to the app name and bookmark star.
- The whole shell UI is driven by CSS custom properties on `:root`; a
  `:root[data-theme="light"]` override block flips every color. `App.tsx` sets
  `document.documentElement.setAttribute('data-theme', theme)` and persists the
  choice in `localStorage` (`pvb-theme`).
- Loaded **websites** follow the theme best-effort: the renderer sends
  `browser:set-theme`, and the main process sets `nativeTheme.themeSource` so
  sites honoring `prefers-color-scheme` render light/dark accordingly.

### Vault sidebar collapse / minimize (Feature 2)

- An arrow button to the right of the `+` collapses/expands the sidebar
  (persisted in `localStorage` as `pvb-sidebar-collapsed`).
- **Minimized mode** shows only account labels: the **active** account is green,
  other visible accounts are white, and used-but-inactive accounts are hidden.
  Full details (status badge, time remaining, actions) show only when expanded.
- Collapsing narrows the sidebar (280px → 120px). The renderer reports the width
  via `browser:sidebar-width`; the main process (`tabManager.updateSidebarWidth`)
  repositions the active `BrowserView` so the page follows the layout.

### Categories / folders (Feature 3)

- A category bar sits at the **bottom** of the sidebar with an "All" chip, one
  chip per category, and a **new-category** button (`📁＋`) on the right.
- Overflowing chips can be revealed by **dragging** (hold left-click) or
  wheel-scrolling the strip horizontally.
- **Right-click** a category chip for **Edit** / **Delete**.
- The create/edit modal (rendered above the page via `tabs.setOverlay`) takes a
  name, an icon (12 basic emojis or a custom uploaded image < 256 KB, stored as a
  `data:` URL), a **Global/Private** scope, and a checklist of accounts. One
  account can belong to multiple categories.
- **Global** categories appear on **all** sites; **Private** categories are tied
  to the site they were created on (`domain`), so a private category made on
  `chatgpt.com` does **not** show on `claude.ai`. Per-site login *status* stays
  keyed by `(loginEntryId, domain)`, so "logged in within 24h" remains
  session/site-specific even for global categories.
- Data model: a `categories` table (`id, name, icon, scope, domain, position,
  timestamps`) plus a `category_accounts` many-to-many join table
  (`ON DELETE CASCADE`). Both are `CREATE TABLE IF NOT EXISTS`, so they
  auto-create on next launch — no manual migration. Managed by
  `src/main/services/category-manager.ts` over the `categories:*` IPC channels.

## Settings tab & account-status model (v0.5.0)

### Settings tab

A ⚙ button in the address bar's right cluster opens a **Settings** surface that
fills the browser area (the `BrowserView` is detached via `tabs.setOverlay`, so
the panel is fully interactive). It has two sections:

- **Site accounts** — every site that has saved accounts, grouped by domain,
  with each account's label, username/email and current per-site status badge.
  Unscoped/legacy accounts are grouped separately.
- **Data management** — clear the browser's **cache**, **cookies**, and/or
  **site storage** (localStorage / IndexedDB / service workers). This clears the
  default session and every open tab's isolated partition session; it does
  **not** delete saved accounts.

Backed by `src/main/ipc/settings.ipc.ts` over the `settings:site-accounts` and
`settings:clear-data` IPC channels.

### Account status model (revised)

Per-site status is computed by `StatusManager.computeCurrentStatus`:

- **Active tab** (green) — the single most-recently-logged-in account on a
  domain. There is only ever **one** active account per domain: marking an
  account active demotes any previously-active account to **Used**.
- **Used** (red) — an account that was logged in / active but has since been
  superseded by another account (or had its tab closed).
- **Never used** (muted) — no login recorded, or the 24h window has lapsed.
- The **24h window** is tracked from the *first* login (`first_login_at` /
  `logged_in_until`). Once it lapses, the account's status **refreshes back to
  "never used"** and its active-tab link is cleared (done lazily on every read
  via `expireStale`).

Switching to another account for a site (from the sidebar or by opening its
tab) re-marks it active and flips the previous one to **Used**. The minimized
vault sidebar shows labels only for accounts whose status is **never used**
(white) or **active tab** (green) — **Used** accounts are hidden there.

The new `'used'` status was added to the `LoginStatus` union, the DB
`CHECK` constraint (with a migration in `src/main/db/index.ts` that rebuilds
`site_login_status` for existing databases), and the sidebar/settings badges.

## Branding & UI polish (v0.6.0)

- **Renamed** the product to **Vault Browser Desktop** (`APP_NAME`,
  `package.json` `name`/`productName`, window title, renderer `<title>`).
- **App icon** — the window/executable icon is `resources/icon.png`
  (the "main" logo). Source logos live in `assets/renderer/` and are copied
  into `dist/renderer/` at build time by `scripts/copy-assets.js`.
- **Address-bar logo** — the plain "Vault Browser" text (previously between the
  bookmark star and the theme toggle) is now a small logo image that is
  **theme-aware**: the *light* logo (`vault-browser-light.png`) shows on the
  dark/night theme, and the *main* logo (`vault-browser-main.png`) shows on the
  light theme.
- **Removed** the page-title indicator that sat between the URL input and the
  bookmark star; the URL field now runs straight into the star button.
- **Category right-click menu** now opens **above** the clicked category chip
  (anchored to the chip's bounding rect and grown upward via CSS `bottom`),
  so its Edit / Delete options are no longer clipped under the OS taskbar. The
  `left` position is clamped to keep the menu inside the viewport.

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
- ✅ Address-bar star toggles a bookmark for the current page (replaces the old
  address-bar "+"; the tab strip keeps its own new-tab button) (v0.3.3)
- ✅ Open tabs show the real site name (live page `<title>`, else the host) for
  the active and background tabs, instead of always "New Tab" (v0.3.3)
- ✅ Each account in the sidebar has a delete (✕) button with a confirmation
  modal before removal (v0.3.3)
- ✅ Light / Night theme toggle for the whole shell UI + best-effort website
  theming via `nativeTheme.themeSource` (v0.4.0)
- ✅ Vault sidebar collapse/minimize: label-only view (active=green, others=white,
  inactive hidden) and the BrowserView follows the narrowed sidebar (v0.4.0)
- ✅ Categories/folders: bottom category bar with drag-scroll overflow,
  right-click edit/delete, create/edit modal (icon picker + custom upload,
  account checklist), and Global vs Private (site-specific) scope (v0.4.0)
- ✅ Settings tab (⚙): site-account management (accounts grouped by site with
  their status) and data management (clear cache / cookies / site storage) (v0.5.0)
- ✅ Revised status model: single "active tab" per site, new "Used" (red) status
  for superseded accounts, and a 24h window that refreshes to "never used"; the
  minimized sidebar shows only never-used and active-tab accounts (v0.5.0)
- ✅ Renamed to **Vault Browser Desktop**; new app icon and a theme-aware
  address-bar logo (light logo on night theme, main logo on light theme) (v0.6.0)
- ✅ Removed the address-bar page-title text; category right-click Edit/Delete
  menu now opens above the chip instead of being clipped under the taskbar (v0.6.0)
- ✅ CI workflow running type-checks, build and unit tests
- ⚠️ Remaining: exercise the full flow on a real Windows desktop (GUI can't run
  in CI/sandbox); optional migration from deprecated `BrowserView` to
  `WebContentsView`.
