// ============================================================================
// Renderer API accessor with safe fallback
// ============================================================================
// App.tsx previously did `const api = window.pvbAPI` directly. If the preload
// script hasn't run (e.g. running the renderer standalone, or the browser
// engine / IPC layer isn't wired yet) `window.pvbAPI` is undefined and the
// whole shell crashes to a blank screen.
//
// This module returns the real preload-provided API when present, otherwise a
// mock implementation backed by placeholder data. That guarantees the full
// browser shell (top bar, bookmarks bar, sidebar, tab strip) always renders,
// with clear placeholder content, per the MVP requirement.

import { PvbAPI } from './types.d';
import { LoginEntry, Bookmark, TabInfo, IpcResponse, SiteLoginStatus } from '../shared/types';

const now = () => new Date().toISOString();

// ---- Mock/placeholder data ------------------------------------------------

const MOCK_LOGIN_ENTRIES: LoginEntry[] = [
  { id: 'mock-1', label: 'Personal Email', usernameOrEmail: 'you@example.com', createdAt: now(), updatedAt: now() },
  { id: 'mock-2', label: 'Work Account', usernameOrEmail: 'you@company.com', createdAt: now(), updatedAt: now() },
  { id: 'mock-3', label: 'Social Media', usernameOrEmail: '@yourhandle', createdAt: now(), updatedAt: now() },
];

const MOCK_BOOKMARKS: Bookmark[] = [
  { id: 'bm-1', title: 'Example', url: 'https://example.com', position: 0, createdAt: now() },
  { id: 'bm-2', title: 'Search', url: 'https://duckduckgo.com', position: 1, createdAt: now() },
];

function ok<T>(data: T): Promise<IpcResponse<T>> {
  return Promise.resolve({ success: true, data });
}

/**
 * Builds an in-memory mock API so the shell is fully interactive without the
 * main process. Tabs live only in this closure.
 */
function createMockApi(): PvbAPI & { __isMock: true } {
  let tabs: TabInfo[] = [];
  let counter = 0;

  const makeTab = (): TabInfo => {
    counter += 1;
    return {
      id: `mock-tab-${counter}`,
      type: 'guest',
      currentUrl: 'about:blank',
      domain: null,
      loginEntryId: null,
      partitionId: `mock-partition-${counter}`,
      createdAt: now(),
      lastActiveAt: now(),
    };
  };

  return {
    __isMock: true,

    credentials: {
      list: () => ok(MOCK_LOGIN_ENTRIES),
      create: (data) =>
        ok({ id: `mock-${Date.now()}`, label: data.label, usernameOrEmail: data.usernameOrEmail, createdAt: now(), updatedAt: now() }),
      update: (data) =>
        ok({ id: data.id, label: data.label || '', usernameOrEmail: data.usernameOrEmail || '', createdAt: now(), updatedAt: now() }),
      delete: () => ok(undefined),
    },

    bookmarks: {
      list: () => ok(MOCK_BOOKMARKS),
      create: (data) => ok({ id: `bm-${Date.now()}`, title: data.title, url: data.url, position: 99, createdAt: now() }),
      delete: () => ok(undefined),
      reorder: () => ok(undefined),
    },

    status: {
      getForDomain: () => ok([] as (SiteLoginStatus & { loginLabel: string; loginUsername: string })[]),
      getAll: () => ok([] as (SiteLoginStatus & { loginLabel: string; loginUsername: string })[]),
    },

    tabs: {
      createGuest: () => {
        const t = makeTab();
        tabs.push(t);
        return ok(t);
      },
      createLogin: (loginEntryId, url) => {
        const t = { ...makeTab(), type: 'login_entry' as const, loginEntryId, currentUrl: url };
        tabs.push(t);
        return ok(t);
      },
      close: (tabId) => {
        tabs = tabs.filter((t) => t.id !== tabId);
        return ok(undefined);
      },
      switch: () => ok(undefined),
      navigate: () => ok(undefined),
      goBack: () => ok(undefined),
      goForward: () => ok(undefined),
      refresh: () => ok(undefined),
      list: () => ok(tabs),
    },

    autofill: {
      // In mock mode there is no real page, so autofill "fails" gracefully;
      // App.tsx treats a failed autofill as "open a login tab instead".
      execute: () => Promise.resolve({ success: false, error: 'mock: no live page' }),
    },

    sendChromeHeight: () => { /* no-op in mock mode */ },

    on: () => () => { /* no events in mock mode */ },
  };
}

let cached: (PvbAPI & { __isMock?: boolean }) | null = null;

/**
 * Returns the real preload API if available, otherwise a mock fallback.
 * `isMockApi()` can be used by the UI to show a "placeholder mode" banner.
 */
export function getApi(): PvbAPI & { __isMock?: boolean } {
  if (cached) return cached;
  const real = (window as any).pvbAPI as PvbAPI | undefined;
  if (real && typeof real.tabs?.createGuest === 'function') {
    cached = real;
  } else {
    console.warn('[api] window.pvbAPI unavailable — using in-memory mock API (placeholder mode).');
    cached = createMockApi();
  }
  return cached;
}

export function isMockApi(): boolean {
  return !!getApi().__isMock;
}
