// ============================================================================
// Password Vault Browser — Main App Component
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import AddressBar from './components/AddressBar';
import BookmarksBar from './components/BookmarksBar';
import Sidebar from './components/Sidebar';
import TabStrip from './components/TabStrip';
import CategoryModal from './components/CategoryModal';
import SettingsPanel from './components/SettingsPanel';
import SaveLoginPageModal from './components/SaveLoginPageModal';
import SaveBookmarkModal, { BookmarkDraft } from './components/SaveBookmarkModal';
import { Theme } from './components/ThemeToggle';
import { LoginEntry, Bookmark, SiteLoginStatus, TabInfo, LoginStatus, Category, LoginConnection } from '../shared/types';
import { WebviewTag } from './types.d';
import { getApi, isMockApi } from './api';
import { normalizeUrlOrSearch, domainFromUrl } from '../shared/url-utils';

const THEME_KEY = 'pvb-theme';
const SIDEBAR_COLLAPSED_KEY = 'pvb-sidebar-collapsed';

/**
 * Status badge state for each login entry on the current domain.
 * This is what drives the sidebar rendering.
 */
interface EntryWithStatus {
  entry: LoginEntry;
  status: LoginStatus | null;
  statusInfo: SiteLoginStatus | null;
}

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

// Compute chrome height values (must match CSS variables)
const ADDRESS_BAR_HEIGHT = 48;
const BOOKMARKS_BAR_HEIGHT = 36;
const TAB_STRIP_HEIGHT = 36;
const CHROME_HEIGHT = ADDRESS_BAR_HEIGHT + BOOKMARKS_BAR_HEIGHT + TAB_STRIP_HEIGHT;

export default function App() {
  // ---- State ----
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  // Login-page connection context for the current URL. Drives the 3 vault
  // sidebar scenarios and — crucially — the CANONICAL account domain that
  // accounts/status/categories load under, so accounts stay in sync across the
  // login page, the main website and any related/nested URL.
  const [connection, setConnection] = useState<LoginConnection | null>(null);
  const [currentTitle, setCurrentTitle] = useState('New Tab');
  const [navigationState, setNavigationState] = useState<NavigationState>({ canGoBack: false, canGoForward: false, isLoading: false });
  // Estimated page-load progress (0..1). Drives the light-blue loading bar
  // under the URL input. null = idle/hidden.
  const [loadProgress, setLoadProgress] = useState<number | null>(null);

  const [loginEntries, setLoginEntries] = useState<LoginEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [domainStatuses, setDomainStatuses] = useState<EntryWithStatus[]>([]);

  // All accounts across every site (unscoped). Needed so a GLOBAL category can
  // show its member accounts on sites where they haven't been used yet — those
  // accounts aren't in the per-site `domainStatuses` list.
  const [allEntries, setAllEntries] = useState<LoginEntry[]>([]);

  // Bug 3: Save-bookmark modal state. When open, holds the existing folder
  // names so the user can place the bookmark; null = modal closed.
  const [bookmarkModalFolders, setBookmarkModalFolders] = useState<string[] | null>(null);

  const [showAddEntryModal, setShowAddEntryModal] = useState(false);

  // Feature 1: theme (night mode is the default).
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    return saved === 'light' ? 'light' : 'dark';
  });

  // Feature 2: collapsed/minimized vault sidebar.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  // Feature 3: categories for the current site + the active category filter.
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Settings tab (opens above the browser view).
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Save-as-Login-Page modal (opens above the browser view).
  const [loginPageModalOpen, setLoginPageModalOpen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);

  const api = getApi();
  const mockMode = isMockApi();

  // ---- Theme (Feature 1) ----

  useEffect(() => {
    // Apply to the shell UI via a root attribute (night mode = default/no attr).
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
    // Best-effort: make loaded websites follow the theme via prefers-color-scheme.
    api.sendTheme?.(theme);
  }, [theme, api]);

  const handleToggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // ---- Settings ----

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    api.tabs.setOverlay(true);
  }, [api]);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    api.tabs.setOverlay(false);
  }, [api]);

  // ---- Save current page as a login page ----

  const handleOpenLoginPageModal = useCallback(() => {
    setLoginPageModalOpen(true);
    api.tabs.setOverlay(true);
  }, [api]);

  const handleCloseLoginPageModal = useCallback(() => {
    setLoginPageModalOpen(false);
    api.tabs.setOverlay(false);
  }, [api]);

  // ---- Sidebar collapse (Feature 2) ----

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Report the current sidebar width to the main process so the BrowserView is
  // repositioned to follow the collapsed/expanded sidebar (must match the CSS
  // widths: 280px expanded, 120px collapsed).
  useEffect(() => {
    api.sendSidebarWidth?.(sidebarCollapsed ? 120 : 280);
  }, [sidebarCollapsed, api]);

  // ---- Data loading ----
  // Note: the sidebar's account list is loaded together with its statuses by
  // loadDomainStatuses() (keyed on the canonical account domain), so there is
  // no separate loadLoginEntries — that split was what let entries & statuses
  // drift out of sync and blank the sidebar.

  const loadBookmarks = useCallback(async () => {
    const res = await api.bookmarks.list();
    if (res.success && res.data) {
      setBookmarks(res.data);
    }
  }, [api]);

  // Feature 3: categories visible for the current site (global + this site's
  // private ones). Reloaded whenever the site changes.
  const loadCategories = useCallback(async (domain?: string | null) => {
    const res = await api.categories.list(domain || undefined);
    if (res.success && res.data) {
      setCategories(res.data);
      // If the active category is no longer visible (e.g. site changed), reset.
      setActiveCategoryId(prev => (prev && res.data!.some(c => c.id === prev)) ? prev : null);
    }
  }, [api]);

  // Load the sidebar entries AND their per-site statuses for a domain, keeping
  // the two in lock-step. This fetches the account list for the domain ITSELF
  // (instead of merging over the `loginEntries` state closure), so there is no
  // window where statuses are merged against a stale/empty entry list — the
  // race that could blank the sidebar when returning from an unrelated tab.
  //
  // It also updates `loginEntries` so every consumer (autofill, categories)
  // sees the same domain-scoped list. Callers pass the CANONICAL account
  // domain (see reloadStatusesForUrl / accountDomain).
  const loadDomainStatuses = useCallback(async (domain: string | null) => {
    // 1. Fetch the accounts scoped to this domain (empty domain = the global
    //    unscoped list). This is the authoritative entry list for the sidebar.
    const entriesRes = await api.credentials.list(domain || undefined);
    const entries: LoginEntry[] = (entriesRes.success && entriesRes.data) ? entriesRes.data : [];

    // 2. Fetch the matching statuses. For a real domain we read the per-domain
    //    bucket; with no domain we fall back to the global status set.
    const statusRes = domain
      ? await api.status.getForDomain(domain)
      : await api.status.getAll();

    const statusMap = new Map<string, SiteLoginStatus>();
    if (statusRes.success && statusRes.data) {
      for (const s of statusRes.data) statusMap.set(s.loginEntryId, s);
    }

    const merged: EntryWithStatus[] = entries.map(entry => {
      const ds = statusMap.get(entry.id) || null;
      return {
        entry,
        status: ds ? ds.status : 'never_used',
        statusInfo: ds,
      };
    });

    // 3. Commit both together so the sidebar never renders statuses against a
    //    mismatched entry list.
    setLoginEntries(entries);
    setDomainStatuses(merged);

    // 4. Also refresh the global account list (used to resolve global-category
    //    members that aren't yet used on this site).
    const allRes = await api.credentials.list();
    if (allRes.success && allRes.data) setAllEntries(allRes.data);
  }, [api]);

  // Resolve the CANONICAL account domain for a URL (via the login-page
  // connection) and reload statuses under it. Use this after opening/switching
  // a login tab so the sidebar reads the same status bucket the main process
  // wrote to — reloading under a raw tab domain shows everything as
  // "never used" for connected sites.
  const reloadStatusesForUrl = useCallback(async (url: string | null) => {
    if (!url) return;
    let domain: string | null = null;
    try {
      const res = await api.loginPages.connection(url);
      if (res.success && res.data && res.data.scenario !== 'standalone' && res.data.accountDomain) {
        domain = res.data.accountDomain;
      }
    } catch { /* fall back below */ }
    if (!domain) {
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    }
    loadDomainStatuses(domain);
  }, [api, loadDomainStatuses]);

  // The CANONICAL domain accounts/status/categories are keyed on. When the
  // current URL is a login page or a page connected to one, this is the
  // mapping's login domain (so the account list is identical across the login
  // page, the main website and every related URL). Otherwise it's the raw
  // current domain.
  const accountDomain = (connection && connection.scenario !== 'standalone' && connection.accountDomain)
    ? connection.accountDomain
    : currentDomain;

  // Keep the latest canonical account domain in a ref so long-lived event
  // handlers (IPC subscriptions registered once) always reload statuses under
  // the CURRENT canonical key instead of a stale closure value. Without this,
  // a status-changed event for the login domain would reload under the raw
  // domain and the sidebar would show everything as "never used".
  const accountDomainRef = useRef<string | null>(accountDomain);
  useEffect(() => {
    accountDomainRef.current = accountDomain;
  }, [accountDomain]);

  // ---- Initial load ----

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  // Resolve the login-page connection whenever the current URL changes.
  useEffect(() => {
    let cancelled = false;
    if (!currentUrl || currentUrl === 'about:blank') {
      setConnection(null);
      return;
    }
    (async () => {
      const res = await api.loginPages.connection(currentUrl);
      if (!cancelled && res.success && res.data) setConnection(res.data);
    })();
    return () => { cancelled = true; };
  }, [currentUrl, api]);

  // Per-site accounts (#3): reload the login entries whenever the active
  // account domain changes so the sidebar shows this connection group's
  // accounts (login page + main site + related URLs share one list).
  // When the active account domain changes, load its accounts + statuses
  // together (loadDomainStatuses fetches the domain's account list itself and
  // sets both loginEntries and domainStatuses atomically), plus its categories.
  // Driving everything from the single `accountDomain` key — rather than
  // chaining an entries-changed effect — removes the race that could leave the
  // sidebar empty when returning to a tab after visiting an unrelated site.
  useEffect(() => {
    loadDomainStatuses(accountDomain);
    loadCategories(accountDomain);
  }, [accountDomain, loadDomainStatuses, loadCategories]);

  // ---- Webview management ----

  const renderBrowserView = useCallback((tabId: string | null) => {
    if (!contentRef.current) return;

    // Clear content area
    contentRef.current.innerHTML = '';

    if (!tabId) {
      // Show empty state
      contentRef.current.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🌐</div>
          <div class="empty-state-text">Open a tab to start browsing</div>
        </div>
      `;
      webviewRef.current = null;
      return;
    }

    // The main process manages BrowserViews directly.
    // The renderer just coordinates via IPC — the actual BrowserView
    // is attached/detached by the main process.
    contentRef.current.innerHTML = `
      <div class="empty-state" data-tab-id="${tabId}">
        <div class="empty-state-icon">📄</div>
        <div class="empty-state-text">Loading...</div>
      </div>
    `;
    webviewRef.current = null;

    // Read initial tab data from the main process
    setCurrentUrl(tabs.find(t => t.id === tabId)?.currentUrl || '');
    setCurrentTitle(tabs.find(t => t.id === tabId)?.type === 'guest' ? 'New Tab' : 'Loading...');
  }, [tabs]);

  // ---- Tab management ----

  const handleNewGuestTab = useCallback(async () => {
    const res = await api.tabs.createGuest();
    if (res.success && res.data) {
      const newTab = res.data;
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setCurrentUrl('about:blank');
      setCurrentTitle('New Tab');
      setCurrentDomain(null);
      // Tell main process to switch view
      await api.tabs.switch(newTab.id);
    }
  }, [api]);

  const handleSelectLoginEntry = useCallback(async (loginEntryId: string) => {
    if (!activeTabId || !currentUrl || currentUrl === 'about:blank') {
      console.warn('[App] No active tab or URL to autofill on');
      return;
    }

    // Check if current tab already belongs to another login entry
    const currentTab = tabs.find(t => t.id === activeTabId);

    // Step 0: If a saved login-page mapping applies to this site + account,
    // open the saved login page (and autofill there) instead of the current
    // page. This makes the main page / related pages route to the login page.
    const resolved = await api.loginPages.resolve(currentUrl, loginEntryId);
    if (resolved.success && resolved.data) {
      const targetUrl = resolved.data.loginUrl;
      // Reuse a plain guest tab (close it first) before opening the login tab.
      if (currentTab?.type === 'guest') {
        await api.tabs.close(activeTabId);
        setTabs(prev => prev.filter(t => t.id !== activeTabId));
      }
      const mapRes = await api.tabs.createLogin(loginEntryId, targetUrl);
      if (mapRes.success && mapRes.data) {
        const newTab = mapRes.data;
        setTabs(prev => (prev.some(t => t.id === newTab.id) ? prev : [...prev, newTab]));
        setActiveTabId(newTab.id);
        setCurrentUrl(newTab.currentUrl);
        setCurrentDomain(newTab.domain);
        setCurrentTitle('Loading...');
        await api.tabs.switch(newTab.id);
        // Reload under the CANONICAL account domain of the opened login URL.
        setTimeout(() => reloadStatusesForUrl(newTab.currentUrl), 200);
      }
      return;
    }

    // Step 1: Try autofill on the current tab if hostname matches
    const res = await api.autofill.execute(activeTabId, loginEntryId, currentUrl);
    if (res.success) {
      // Reload under the canonical account domain of the current page.
      reloadStatusesForUrl(currentUrl);
      return;
    }

    // Step 2: If current tab is a guest tab, reuse it by creating a login-entry tab
    // for the same URL. The main process will switch the BrowserView.
    if (currentTab?.type === 'guest') {
      // Close the guest tab first (cleans up partition)
      await api.tabs.close(activeTabId);
      setTabs(prev => prev.filter(t => t.id !== activeTabId));
    }

    // Step 3: Create (or switch to) a login-entry tab with dedup
    const loginRes = await api.tabs.createLogin(loginEntryId, currentUrl);
    if (loginRes.success && loginRes.data) {
      const newTab = loginRes.data;

      if ((newTab as any).switched) {
        // Existing tab found — just switch to it
        setActiveTabId(newTab.id);
        setCurrentUrl(newTab.currentUrl);
        setCurrentDomain(newTab.domain);
        setCurrentTitle('Loading...');
        await api.tabs.switch(newTab.id);
      } else {
        // New isolated tab created
        setTabs(prev => {
          const exists = prev.some(t => t.id === newTab.id);
          return exists ? prev : [...prev, newTab];
        });
        setActiveTabId(newTab.id);
        setCurrentUrl(newTab.currentUrl);
        setCurrentDomain(newTab.domain);
        setCurrentTitle('Loading...');
        await api.tabs.switch(newTab.id);
      }

      // Reload domain statuses after login-entry use, under the CANONICAL
      // account domain of the tab's URL (keeps login/main/related in sync).
      setTimeout(() => reloadStatusesForUrl(newTab.currentUrl), 200);
    }
  }, [activeTabId, currentUrl, currentDomain, tabs, api, loadDomainStatuses, reloadStatusesForUrl]);

  const handleCloseTab = useCallback(async (tabId: string) => {
    await api.tabs.close(tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));

    // The URL we should reload statuses for after the close (the now-active
    // tab's URL, or the still-current URL if we closed a background tab).
    let reloadUrl: string | null = currentUrl;

    if (activeTabId === tabId) {
      const remaining = tabs.filter(t => t.id !== tabId);
      if (remaining.length > 0) {
        const lastTab = remaining[remaining.length - 1];
        setActiveTabId(lastTab.id);
        setCurrentUrl(lastTab.currentUrl);
        setCurrentDomain(lastTab.domain);
        setCurrentTitle(lastTab.type === 'guest' ? 'New Tab' : 'Loading...');
        await api.tabs.switch(lastTab.id);
        reloadUrl = lastTab.currentUrl;
      } else {
        setActiveTabId(null);
        setCurrentUrl('');
        setCurrentDomain(null);
        setCurrentTitle('Vault Browser Desktop');
        reloadUrl = null;
      }
    }

    // Update domain statuses after tab close, under the CANONICAL account
    // domain of whatever tab is now active (keeps login/main/related in sync).
    // When NO tab remains (reloadUrl === null) we must still refresh — via the
    // global getAll() path — so the just-closed tab's "Active tab" flag clears
    // instead of lingering (reloadStatusesForUrl(null) is a no-op).
    setTimeout(() => {
      if (reloadUrl) {
        reloadStatusesForUrl(reloadUrl);
      } else {
        loadDomainStatuses(null);
      }
    }, 100);
  }, [activeTabId, tabs, api, currentDomain, currentUrl, loadDomainStatuses, reloadStatusesForUrl]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      setCurrentUrl(tab.currentUrl);
      setCurrentDomain(tab.domain);
      setCurrentTitle(tab.type === 'guest' ? 'New Tab' : 'Loading...');
    }
    await api.tabs.switch(tabId);

    // Reload domain statuses for the new tab, keyed on the CANONICAL account
    // domain (login page + main site + related URLs share one bucket) — NOT
    // the raw tab.domain. Reading under the raw domain is exactly what made
    // every account show "never used" after a tab switch. reloadStatusesForUrl
    // resolves the canonical key from the tab's URL before loading.
    if (tab?.currentUrl && tab.currentUrl !== 'about:blank') {
      reloadStatusesForUrl(tab.currentUrl);
    } else {
      // New/blank tab: show the global (unscoped) account list rather than
      // mapping over a possibly-stale loginEntries closure. loadDomainStatuses
      // fetches the list itself so the sidebar is always correct & consistent.
      loadDomainStatuses(null);
    }
  }, [tabs, api, reloadStatusesForUrl, loadDomainStatuses]);

  // ---- Tab context-menu actions (Issue 4) ----

  // Duplicate a tab: open its current URL in a fresh guest tab and activate it.
  const handleDuplicateTab = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    const url = tab?.currentUrl;
    if (!url || url === 'about:blank') return;
    const res = await api.tabs.createGuest();
    if (res.success && res.data) {
      const newTab = res.data;
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setCurrentTitle('Loading...');
      await api.tabs.switch(newTab.id);
      await api.tabs.navigate(url);
      setCurrentUrl(url);
      setCurrentDomain(domainFromUrl(url));
    }
  }, [tabs, api]);

  // Close every tab except the given one.
  const handleCloseOtherTabs = useCallback(async (keepTabId: string) => {
    const others = tabs.filter(t => t.id !== keepTabId);
    for (const t of others) {
      await api.tabs.close(t.id);
    }
    const kept = tabs.find(t => t.id === keepTabId);
    setTabs(kept ? [kept] : []);
    if (activeTabId !== keepTabId && kept) {
      setActiveTabId(kept.id);
      setCurrentUrl(kept.currentUrl);
      setCurrentDomain(kept.domain);
      setCurrentTitle(kept.type === 'guest' ? 'New Tab' : 'Loading...');
      await api.tabs.switch(kept.id);
    }
  }, [tabs, api, activeTabId]);

  // Reload a tab: make it active (if not already) then refresh it.
  const handleReloadTab = useCallback(async (tabId: string) => {
    if (activeTabId !== tabId) {
      await handleSwitchTab(tabId);
    }
    await api.tabs.refresh();
  }, [activeTabId, api, handleSwitchTab]);

  const handleNavigate = useCallback(async (input: string) => {
    // Normalize raw address-bar input: bare domains get https://, and
    // free text becomes a search query.
    const url = normalizeUrlOrSearch(input);

    // If there is no active tab yet, open one so navigation has a target.
    if (!activeTabId) {
      const res = await api.tabs.createGuest();
      if (res.success && res.data) {
        setTabs(prev => [...prev, res.data!]);
        setActiveTabId(res.data.id);
        await api.tabs.switch(res.data.id);
      }
    }

    await api.tabs.navigate(url);
    setCurrentUrl(url);
    setCurrentDomain(domainFromUrl(url));
  }, [api, activeTabId]);

  const handleGoBack = useCallback(async () => {
    await api.tabs.goBack();
  }, [api]);

  const handleGoForward = useCallback(async () => {
    await api.tabs.goForward();
  }, [api]);

  const handleRefresh = useCallback(async () => {
    await api.tabs.refresh();
  }, [api]);

  // ---- Event listeners from main process ----

  useEffect(() => {
    const unsub1 = api.on('event:tab-url-changed', (data: any) => {
      // Keep the tab strip in sync for ANY tab (not just the active one) so
      // each tab shows the real site it navigated to instead of "New Tab".
      setTabs(prev => prev.map(t =>
        t.id === data.tabId
          ? { ...t, currentUrl: data.url, domain: data.domain }
          : t
      ));
      if (data.tabId === activeTabId) {
        setCurrentUrl(data.url);
        setCurrentDomain(data.domain);
        setNavigationState(prev => ({
          ...prev,
          canGoBack: data.canGoBack,
          canGoForward: data.canGoForward,
        }));
      }
    });

    // A new tab was created by the main process (e.g. "Open Link in New Tab"
    // from the webpage right-click menu). Add it to the strip and activate it.
    const unsubCreated = api.on('event:tab-created', (data: any) => {
      if (!data || !data.id) return;
      setTabs(prev => (prev.some(t => t.id === data.id) ? prev : [...prev, data]));
      setActiveTabId(data.id);
      setCurrentUrl(data.currentUrl || 'about:blank');
      setCurrentDomain(data.domain ?? null);
      setCurrentTitle('Loading...');
    });

    const unsub2 = api.on('event:page-title-changed', (data: any) => {
      // Store the live page title on the tab so the tab strip label reflects
      // the actual site name (e.g. "Claude"), for the active or background tab.
      setTabs(prev => prev.map(t =>
        t.id === data.tabId ? { ...t, title: data.title } : t
      ));
      if (data.tabId === activeTabId) {
        setCurrentTitle(data.title);
      }
    });

    const unsub3 = api.on('event:nav-state-changed', (data: any) => {
      if (data.tabId === activeTabId) {
        setNavigationState(prev => ({
          isLoading: data.isLoading ?? prev.isLoading,
          canGoBack: data.canGoBack ?? prev.canGoBack,
          canGoForward: data.canGoForward ?? prev.canGoForward,
        }));
      }
    });

    // Per-site login status changed in the main process (e.g. after autofill).
    // The main process now emits the CANONICAL account domain, so refresh the
    // sidebar when the event concerns our canonical domain (or is global).
    // Always reload under the canonical key (accountDomainRef), never the raw
    // current domain — otherwise the sidebar reads the wrong status bucket.
    const unsub4 = api.on('event:status-changed', (data: any) => {
      const canonical = accountDomainRef.current;
      if (!data?.domain || data.domain === canonical || data.domain === currentDomain) {
        loadDomainStatuses(canonical);
      }
    });

    // Estimated page-load progress -> drives the light-blue bar under the URL.
    // When it reaches 1 (100%), briefly show the full bar then hide it.
    const unsub5 = api.on('event:load-progress', (data: any) => {
      if (data.tabId !== activeTabId) return;
      const p = typeof data.progress === 'number' ? data.progress : 0;
      if (p >= 1) {
        setLoadProgress(1);
        window.setTimeout(() => setLoadProgress(null), 250);
      } else {
        setLoadProgress(p);
      }
    });

    return () => {
      unsub1();
      unsubCreated();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
    };
  }, [api, activeTabId, currentDomain, loadDomainStatuses]);

  // Reset the loading bar when switching tabs so a stale progress value from
  // the previous tab doesn't linger.
  useEffect(() => {
    setLoadProgress(null);
  }, [activeTabId]);

  // ---- Window resize -> update BrowserView bounds ----

  useEffect(() => {
    const handleResize = () => {
      // Tell main process the chrome height so it can reposition the BrowserView
      api.sendChromeHeight(CHROME_HEIGHT);
    };

    window.addEventListener('resize', handleResize);

    // Initial chrome height notification after mount
    setTimeout(handleResize, 500);

    return () => window.removeEventListener('resize', handleResize);
  }, [api]);

  // ---- Modal handlers ----

  const [modalData, setModalData] = useState({ label: '', usernameOrEmail: '', password: '' });
  const [modalError, setModalError] = useState<string | null>(null);
  // Bug 4: show/hide the password in the Add Account modal.
  const [showAddPassword, setShowAddPassword] = useState(false);

  const handleOpenAddEntryModal = useCallback(() => {
    setModalData({ label: '', usernameOrEmail: '', password: '' });
    setModalError(null);
    setShowAddPassword(false);
    setShowAddEntryModal(true);
    // #1/#2: Detach the native BrowserView so the HTML modal is visible and
    // interactive on top of any loaded web page.
    api.tabs.setOverlay(true);
  }, [api]);

  const handleCloseAddEntryModal = useCallback(() => {
    setShowAddEntryModal(false);
    setModalError(null);
    // Reattach the BrowserView so the web page is shown again.
    api.tabs.setOverlay(false);
  }, [api]);

  const handleSaveNewEntry = useCallback(async () => {
    if (!modalData.label || !modalData.usernameOrEmail || !modalData.password) return;

    setModalError(null);

    const res = await api.credentials.create({
      label: modalData.label,
      usernameOrEmail: modalData.usernameOrEmail,
      password: modalData.password,
      // Bind the account to the CANONICAL account domain of this connection
      // group, so an account added on the main site / a related URL still
      // appears on the login page (and vice-versa).
      domain: accountDomain || undefined,
    });

    if (res.success) {
      setShowAddEntryModal(false);
      api.tabs.setOverlay(false);
      // Reload entries + statuses together so the new account shows immediately.
      loadDomainStatuses(accountDomain);
    } else {
      // #1: surface duplicate-account (and any other) errors in the modal.
      setModalError(res.error || 'Failed to save account.');
    }
  }, [modalData, api, loadDomainStatuses, accountDomain]);

  // ---- Bookmark handler (#1: star button in the address bar) ----

  const isCurrentBookmarked = !!currentUrl && bookmarks.some(b => b.url === currentUrl);

  // Star button (#3.2): if the page is already bookmarked, remove it; otherwise
  // open the Save-bookmark modal so the user can pick a name and folder.
  const handleAddBookmark = useCallback(async () => {
    if (!currentUrl || currentUrl === 'about:blank') return;
    const existing = bookmarks.find(b => b.url === currentUrl);
    if (existing) {
      const res = await api.bookmarks.delete(existing.id);
      if (res.success) loadBookmarks();
      return;
    }
    // Not yet bookmarked: fetch existing folders and open the modal.
    const foldersRes = await api.bookmarks.folders();
    const folders = (foldersRes.success && foldersRes.data) ? foldersRes.data : [];
    setBookmarkModalFolders(folders);
    // Detach the native BrowserView so the HTML modal renders ON TOP of the
    // web page (otherwise the page draws over the modal).
    api.tabs.setOverlay(true);
  }, [api, currentUrl, bookmarks, loadBookmarks]);

  // Close the Save-bookmark modal and reattach the BrowserView.
  const handleCloseBookmarkModal = useCallback(() => {
    setBookmarkModalFolders(null);
    api.tabs.setOverlay(false);
  }, [api]);

  // Confirm handler for the Save-bookmark modal (#3.2).
  const handleConfirmSaveBookmark = useCallback(async (draft: BookmarkDraft) => {
    const res = await api.bookmarks.create({
      title: draft.title,
      url: draft.url,
      folder: draft.folder,
    });
    if (res.success) loadBookmarks();
    setBookmarkModalFolders(null);
    api.tabs.setOverlay(false);
  }, [api, loadBookmarks]);

  // Remove a bookmark via the X button in the bookmarks bar (#3.1).
  const handleRemoveBookmark = useCallback(async (bookmark: Bookmark) => {
    const res = await api.bookmarks.delete(bookmark.id);
    if (res.success) loadBookmarks();
  }, [api, loadBookmarks]);

  // ---- Delete-account flow (#3: cross icon + confirm modal) ----

  const [entryToDelete, setEntryToDelete] = useState<LoginEntry | null>(null);

  const handleRequestDeleteEntry = useCallback((loginEntryId: string) => {
    const entry = loginEntries.find(e => e.id === loginEntryId) || null;
    if (!entry) return;
    setEntryToDelete(entry);
    // Show the HTML confirm modal on top of any loaded page.
    api.tabs.setOverlay(true);
  }, [loginEntries, api]);

  const handleCancelDeleteEntry = useCallback(() => {
    setEntryToDelete(null);
    api.tabs.setOverlay(false);
  }, [api]);

  const handleConfirmDeleteEntry = useCallback(async () => {
    if (!entryToDelete) return;
    const res = await api.credentials.delete(entryToDelete.id);
    if (res.success) {
      setEntryToDelete(null);
      api.tabs.setOverlay(false);
      // Reload entries + statuses together so the deleted account disappears.
      loadDomainStatuses(accountDomain);
    }
  }, [entryToDelete, api, loadDomainStatuses, accountDomain]);

  // ---- Category handlers (Feature 3) ----

  const handleOpenCreateCategory = useCallback(() => {
    setEditingCategory(null);
    setCategoryModalOpen(true);
    api.tabs.setOverlay(true);
  }, [api]);

  const handleOpenEditCategory = useCallback((category: Category) => {
    setEditingCategory(category);
    setCategoryModalOpen(true);
    api.tabs.setOverlay(true);
  }, [api]);

  const handleCloseCategoryModal = useCallback(() => {
    setCategoryModalOpen(false);
    setEditingCategory(null);
    api.tabs.setOverlay(false);
  }, [api]);

  const handleSaveCategory = useCallback(async (draft: {
    name: string; icon: string; scope: 'global' | 'private'; accountIds: string[]; domain: string;
  }) => {
    // For a private category use the site chosen in the modal; global = no site.
    const privateDomain = draft.scope === 'private'
      ? (draft.domain || accountDomain || undefined)
      : undefined;
    if (editingCategory) {
      await api.categories.update({
        id: editingCategory.id,
        name: draft.name,
        icon: draft.icon,
        scope: draft.scope,
        domain: privateDomain,
        accountIds: draft.accountIds,
      });
    } else {
      await api.categories.create({
        name: draft.name,
        icon: draft.icon,
        scope: draft.scope,
        domain: privateDomain,
        accountIds: draft.accountIds,
      });
    }
    setCategoryModalOpen(false);
    setEditingCategory(null);
    api.tabs.setOverlay(false);
    loadCategories(accountDomain);
  }, [editingCategory, api, accountDomain, loadCategories]);

  const handleDeleteCategory = useCallback(async (category: Category) => {
    const res = await api.categories.delete(category.id);
    if (res.success) {
      if (activeCategoryId === category.id) setActiveCategoryId(null);
      loadCategories(accountDomain);
    }
  }, [api, activeCategoryId, accountDomain, loadCategories]);

  // Filter the sidebar entries by the active category (null = show all).
  //
  // GLOBAL categories behave like a portable account set: on ANY site, every
  // member account is shown as if it belonged to this site. Accounts that have
  // never been used here won't be in `domainStatuses`, so we resolve them from
  // the full account list (`allEntries`) and mark them "never_used" for this
  // site. Logging in with one then registers it for the site (the normal
  // status-changed flow reloads statuses).
  //
  // PRIVATE categories only make sense on their own site, so they keep the
  // simple per-site filter.
  const visibleStatuses = React.useMemo(() => {
    if (!activeCategoryId) return domainStatuses;
    const cat = categories.find(c => c.id === activeCategoryId);
    if (!cat) return domainStatuses;

    const idSet = new Set(cat.accountIds);

    if (cat.scope === 'global') {
      // Index the current site's statuses so we can attach them where present.
      const byId = new Map(domainStatuses.map(s => [s.entry.id, s]));
      const result: EntryWithStatus[] = [];
      for (const accId of cat.accountIds) {
        const existing = byId.get(accId);
        if (existing) {
          result.push(existing);
          continue;
        }
        // Member account not used on this site yet — surface it as never_used.
        const entry = allEntries.find(e => e.id === accId);
        if (entry) {
          result.push({ entry, status: 'never_used', statusInfo: null });
        }
      }
      return result;
    }

    // Private category: only this site's accounts.
    return domainStatuses.filter(s => idSet.has(s.entry.id));
  }, [activeCategoryId, categories, domainStatuses, allEntries]);

  // ---- Render ----

  return (
    <div className="app-layout">
      {mockMode && (
        <div className="placeholder-banner" role="status">
          Placeholder mode — browser engine not connected. Showing mock data so the shell UI is fully visible.
        </div>
      )}

      {/* Chrome: Address bar */}
      <div className="chrome">
        <AddressBar
          url={currentUrl}
          canGoBack={navigationState.canGoBack}
          canGoForward={navigationState.canGoForward}
          isLoading={navigationState.isLoading}
          loadProgress={loadProgress}
          onNavigate={handleNavigate}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onRefresh={handleRefresh}
          onAddBookmark={handleAddBookmark}
          isBookmarked={isCurrentBookmarked}
          onSetLoginPage={handleOpenLoginPageModal}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={handleOpenSettings}
        />

        {/* Bookmarks bar */}
        <BookmarksBar
          bookmarks={bookmarks}
          onNavigate={handleNavigate}
          onRemove={handleRemoveBookmark}
          onOpenFolder={(items, anchor) =>
            api.bookmarks.showFolderMenu({
              items: items.map(b => ({ title: b.title, url: b.url })),
              x: anchor.x,
              y: anchor.y,
            })
          }
        />

        {/* Tab strip */}
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewGuestTab}
          onDuplicateTab={handleDuplicateTab}
          onCloseOtherTabs={handleCloseOtherTabs}
          onReloadTab={handleReloadTab}
        />
      </div>

      {/* Content: Sidebar + Browser */}
      <div className="content-area">
        <Sidebar
          entries={visibleStatuses}
          currentDomain={currentDomain}
          connection={connection}
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onSelectEntry={handleSelectLoginEntry}
          onAddEntry={handleOpenAddEntryModal}
          onDeleteEntry={handleRequestDeleteEntry}
          categories={categories}
          activeCategoryId={activeCategoryId}
          onSelectCategory={setActiveCategoryId}
          onAddCategory={handleOpenCreateCategory}
          onEditCategory={handleOpenEditCategory}
          onDeleteCategory={handleDeleteCategory}
        />

        <div className="browser-area" ref={contentRef}>
          {!activeTabId && !settingsOpen && (
            <div className="empty-state">
              <div className="empty-state-icon">🌐</div>
              <div className="empty-state-text">Open a tab to start browsing</div>
              <button className="modal-btn primary" onClick={handleNewGuestTab} style={{ marginTop: 12 }}>
                + New Tab
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Settings — a full-screen overlay ABOVE all chrome (address bar,
          bookmarks bar, tab strip and sidebar), so it takes over the whole
          window. The native web view is already detached via setOverlay. */}
      {settingsOpen && (
        <div className="settings-fullscreen">
          <SettingsPanel onClose={handleCloseSettings} />
        </div>
      )}

      {/* Add Login Entry Modal */}
      {showAddEntryModal && (
        <div className="modal-overlay" onClick={handleCloseAddEntryModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Add Login Entry</div>
            {currentDomain && (
              <div className="modal-subtitle">for {currentDomain}</div>
            )}

            {modalError && (
              <div className="modal-error" role="alert">{modalError}</div>
            )}

            <div className="modal-field">
              <label className="modal-label">Label</label>
              <input
                className="modal-input"
                placeholder="e.g. John's Work Account"
                value={modalData.label}
                onChange={e => setModalData(prev => ({ ...prev, label: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSaveNewEntry()}
              />
            </div>

            <div className="modal-field">
              <label className="modal-label">Email / Username</label>
              <input
                className="modal-input"
                placeholder="e.g. john@example.com"
                value={modalData.usernameOrEmail}
                onChange={e => setModalData(prev => ({ ...prev, usernameOrEmail: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSaveNewEntry()}
              />
            </div>

            <div className="modal-field">
              <label className="modal-label">Password</label>
              <div className="password-input-wrap">
                <input
                  className="modal-input"
                  type={showAddPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={modalData.password}
                  onChange={e => setModalData(prev => ({ ...prev, password: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSaveNewEntry()}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowAddPassword(v => !v)}
                  aria-label={showAddPassword ? 'Hide password' : 'Show password'}
                  title={showAddPassword ? 'Hide password' : 'Show password'}
                >
                  {showAddPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button className="modal-btn" onClick={handleCloseAddEntryModal}>Cancel</button>
              <button
                className="modal-btn primary"
                onClick={handleSaveNewEntry}
                disabled={!modalData.label || !modalData.usernameOrEmail || !modalData.password}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal (#3) */}
      {entryToDelete && (
        <div className="modal-overlay" onClick={handleCancelDeleteEntry}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Delete account?</div>
            <div className="modal-subtitle">This action cannot be undone.</div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
              Are you sure you want to delete{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{entryToDelete.label}</strong>
              {' '}(<span>{entryToDelete.usernameOrEmail}</span>)
              {entryToDelete.domain ? <> for <strong>{entryToDelete.domain}</strong></> : null}?
            </p>

            <div className="modal-actions">
              <button className="modal-btn" onClick={handleCancelDeleteEntry}>Cancel</button>
              <button className="modal-btn danger" onClick={handleConfirmDeleteEntry}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Create / Edit Modal (Feature 3) */}
      {categoryModalOpen && (
        <CategoryModal
          editing={editingCategory}
          accounts={allEntries.length ? allEntries : loginEntries}
          currentDomain={currentDomain}
          openDomains={Array.from(new Set(tabs.map(t => t.domain).filter(Boolean) as string[]))}
          onCancel={handleCloseCategoryModal}
          onSave={handleSaveCategory}
        />
      )}

      {/* Save-current-page-as-login-page modal */}
      {loginPageModalOpen && (
        <SaveLoginPageModal
          currentUrl={currentUrl}
          currentDomain={currentDomain}
          openedDomains={Array.from(new Set(tabs.map(t => t.domain).filter(Boolean) as string[]))}
          categories={categories}
          onClose={handleCloseLoginPageModal}
          onSaved={(_msg) => { handleCloseLoginPageModal(); }}
        />
      )}

      {/* Save-bookmark modal (#3.2) */}
      {bookmarkModalFolders !== null && (
        <SaveBookmarkModal
          url={currentUrl}
          defaultTitle={currentTitle && currentTitle !== 'Loading...' ? currentTitle : (currentDomain || currentUrl)}
          folders={bookmarkModalFolders}
          onCancel={handleCloseBookmarkModal}
          onSave={handleConfirmSaveBookmark}
        />
      )}

    </div>
  );
}
