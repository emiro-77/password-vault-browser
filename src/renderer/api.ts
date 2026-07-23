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
import { LoginEntry, Bookmark, TabInfo, IpcResponse, SiteLoginStatus, Category } from '../shared/types';

const now = () => new Date().toISOString();

// ---- Mock/placeholder data ------------------------------------------------

const MOCK_LOGIN_ENTRIES: LoginEntry[] = [
  { id: 'mock-1', label: 'Personal Email', usernameOrEmail: 'you@example.com', domain: '', createdAt: now(), updatedAt: now() },
  { id: 'mock-2', label: 'Work Account', usernameOrEmail: 'you@company.com', domain: '', createdAt: now(), updatedAt: now() },
  { id: 'mock-3', label: 'Social Media', usernameOrEmail: '@yourhandle', domain: '', createdAt: now(), updatedAt: now() },
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
  let mockCategories: Category[] = [];

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
      list: (domain) =>
        ok(domain ? MOCK_LOGIN_ENTRIES.filter(e => e.domain === domain || e.domain === '') : MOCK_LOGIN_ENTRIES),
      create: (data) =>
        ok({ id: `mock-${Date.now()}`, label: data.label, usernameOrEmail: data.usernameOrEmail, domain: data.domain || '', createdAt: now(), updatedAt: now() }),
      update: (data) =>
        ok({ id: data.id, label: data.label || '', usernameOrEmail: data.usernameOrEmail || '', domain: '', createdAt: now(), updatedAt: now() }),
      delete: () => ok(undefined),
    },

    bookmarks: {
      list: () => ok(MOCK_BOOKMARKS),
      create: (data) => ok({ id: `bm-${Date.now()}`, title: data.title, url: data.url, position: 99, createdAt: now() }),
      delete: () => ok(undefined),
      reorder: () => ok(undefined),
    },

    categories: {
      list: (domain) => ok(
        mockCategories.filter(c => c.scope === 'global' || (!!domain && c.domain === domain))
      ),
      create: (data) => {
        const cat: Category = {
          id: `cat-${Date.now()}`,
          name: data.name,
          icon: data.icon || '📁',
          scope: data.scope,
          domain: data.scope === 'private' ? (data.domain || '') : '',
          position: mockCategories.length,
          accountIds: data.accountIds || [],
          createdAt: now(),
          updatedAt: now(),
        };
        mockCategories.push(cat);
        return ok(cat);
      },
      update: (data) => {
        const cat = mockCategories.find(c => c.id === data.id);
        if (!cat) return Promise.resolve({ success: false, error: 'not found' });
        Object.assign(cat, {
          name: data.name ?? cat.name,
          icon: data.icon ?? cat.icon,
          scope: data.scope ?? cat.scope,
          domain: data.domain ?? cat.domain,
          accountIds: data.accountIds ?? cat.accountIds,
          updatedAt: now(),
        });
        return ok(cat);
      },
      delete: (id) => {
        mockCategories = mockCategories.filter(c => c.id !== id);
        return ok(undefined);
      },
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
      setOverlay: () => ok(undefined),
    },

    autofill: {
      // In mock mode there is no real page, so autofill "fails" gracefully;
      // App.tsx treats a failed autofill as "open a login tab instead".
      execute: () => Promise.resolve({ success: false, error: 'mock: no live page' }),
    },

    settings: {
      siteAccounts: () => ok([
        {
          domain: 'example.com',
          accounts: [
            { loginEntryId: 'mock-1', label: 'Personal Email', usernameOrEmail: 'you@example.com', status: 'active_tab_open' as const, lastUsedAt: now() },
            { loginEntryId: 'mock-2', label: 'Work Account', usernameOrEmail: 'you@company.com', status: 'used' as const, lastUsedAt: now() },
          ],
        },
        {
          domain: '',
          accounts: [
            { loginEntryId: 'mock-3', label: 'Social Media', usernameOrEmail: '@yourhandle', status: 'never_used' as const, lastUsedAt: null },
          ],
        },
      ]),
      clearData: () => ok({ cleared: ['cache', 'cookies', 'site storage'] }),
    },

    sendChromeHeight: () => { /* no-op in mock mode */ },
    sendTheme: () => { /* no-op in mock mode */ },
    sendSidebarWidth: () => { /* no-op in mock mode */ },

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
