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
import { Theme } from './components/ThemeToggle';
import { LoginEntry, Bookmark, SiteLoginStatus, TabInfo, LoginStatus, Category } from '../shared/types';
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
  const [currentTitle, setCurrentTitle] = useState('New Tab');
  const [navigationState, setNavigationState] = useState<NavigationState>({ canGoBack: false, canGoForward: false, isLoading: false });

  const [loginEntries, setLoginEntries] = useState<LoginEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [domainStatuses, setDomainStatuses] = useState<EntryWithStatus[]>([]);

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

  const loadLoginEntries = useCallback(async (domain?: string | null) => {
    // Per-site accounts: when a domain is active, only that site's accounts
    // (plus legacy unscoped ones) are listed.
    const res = await api.credentials.list(domain || undefined);
    if (res.success && res.data) {
      setLoginEntries(res.data);
    }
  }, [api]);

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

  const loadDomainStatuses = useCallback(async (domain: string | null) => {
    if (!domain) {
      // Load all statuses for global sidebar context
      const res = await api.status.getAll();
      if (res.success && res.data) {
        const merged: EntryWithStatus[] = loginEntries.map(entry => {
          const match = res.data!.find(s => s.loginEntryId === entry.id);
          return {
            entry,
            status: match ? match.status : 'never_used',
            statusInfo: match || null,
          };
        });
        setDomainStatuses(merged);
      }
      return;
    }

    const [statusRes, allRes] = await Promise.all([
      api.status.getForDomain(domain),
      api.status.getAll(),
    ]);

    // Build merged entries with current-domain status highlighted
    const domainStatusMap = new Map<string, SiteLoginStatus>();
    if (statusRes.success && statusRes.data) {
      for (const s of statusRes.data) {
        domainStatusMap.set(s.loginEntryId, s);
      }
    }

    const merged: EntryWithStatus[] = loginEntries.map(entry => {
      const ds = domainStatusMap.get(entry.id) || null;
      return {
        entry,
        status: ds ? ds.status : 'never_used',
        statusInfo: ds,
      };
    });
    setDomainStatuses(merged);
  }, [api, loginEntries]);

  const loadAllData = useCallback(async () => {
    await Promise.all([loadLoginEntries(currentDomain), loadBookmarks()]);
  }, [loadLoginEntries, loadBookmarks, currentDomain]);

  // ---- Initial load ----

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  // Per-site accounts (#3): reload the login entries whenever the active
  // site/domain changes so the sidebar only shows accounts for this site.
  useEffect(() => {
    loadLoginEntries(currentDomain);
    loadCategories(currentDomain);
  }, [currentDomain, loadLoginEntries, loadCategories]);

  // Reload domain statuses when login entries or current domain changes
  useEffect(() => {
    if (loginEntries.length > 0) {
      loadDomainStatuses(currentDomain);
    }
  }, [loginEntries, currentDomain, loadDomainStatuses]);

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

    // Step 1: Try autofill on the current tab if hostname matches
    const res = await api.autofill.execute(activeTabId, loginEntryId, currentUrl);
    if (res.success) {
      if (currentDomain) {
        loadDomainStatuses(currentDomain);
      }
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

      // Reload domain statuses after login-entry use
      if (newTab.domain) {
        setTimeout(() => loadDomainStatuses(newTab.domain), 200);
      }
    }
  }, [activeTabId, currentUrl, currentDomain, tabs, api, loadDomainStatuses]);

  const handleCloseTab = useCallback(async (tabId: string) => {
    await api.tabs.close(tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));

    if (activeTabId === tabId) {
      const remaining = tabs.filter(t => t.id !== tabId);
      if (remaining.length > 0) {
        const lastTab = remaining[remaining.length - 1];
        setActiveTabId(lastTab.id);
        setCurrentUrl(lastTab.currentUrl);
        setCurrentDomain(lastTab.domain);
        setCurrentTitle(lastTab.type === 'guest' ? 'New Tab' : 'Loading...');
        await api.tabs.switch(lastTab.id);
      } else {
        setActiveTabId(null);
        setCurrentUrl('');
        setCurrentDomain(null);
        setCurrentTitle('Password Vault Browser');
      }
    }

    // Update domain statuses after tab close
    if (currentDomain) {
      setTimeout(() => loadDomainStatuses(currentDomain), 100);
    }
  }, [activeTabId, tabs, api, currentDomain, loadDomainStatuses]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      setCurrentUrl(tab.currentUrl);
      setCurrentDomain(tab.domain);
      setCurrentTitle(tab.type === 'guest' ? 'New Tab' : 'Loading...');
    }
    await api.tabs.switch(tabId);

    // Reload domain statuses for the new tab's domain
    if (tab?.domain) {
      loadDomainStatuses(tab.domain);
    } else {
      setDomainStatuses(loginEntries.map(e => ({ entry: e, status: 'never_used', statusInfo: null })));
    }
  }, [tabs, api, loadDomainStatuses, loginEntries]);

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
    // Refresh the sidebar if it concerns the current domain (or is global).
    const unsub4 = api.on('event:status-changed', (data: any) => {
      if (!data?.domain || data.domain === currentDomain) {
        loadDomainStatuses(currentDomain);
      }
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [api, activeTabId, currentDomain, loadDomainStatuses]);

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

  const handleOpenAddEntryModal = useCallback(() => {
    setModalData({ label: '', usernameOrEmail: '', password: '' });
    setModalError(null);
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
      // #3: bind the account to the current site so it's saved per-website.
      domain: currentDomain || undefined,
    });

    if (res.success) {
      setShowAddEntryModal(false);
      api.tabs.setOverlay(false);
      loadLoginEntries(currentDomain);
    } else {
      // #1: surface duplicate-account (and any other) errors in the modal.
      setModalError(res.error || 'Failed to save account.');
    }
  }, [modalData, api, loadLoginEntries, currentDomain]);

  // ---- Bookmark handler (#1: star button in the address bar) ----

  const isCurrentBookmarked = !!currentUrl && bookmarks.some(b => b.url === currentUrl);

  const handleAddBookmark = useCallback(async () => {
    if (!currentUrl || currentUrl === 'about:blank') return;
    // Toggle: if already bookmarked, remove it; otherwise add it.
    const existing = bookmarks.find(b => b.url === currentUrl);
    if (existing) {
      const res = await api.bookmarks.delete(existing.id);
      if (res.success) loadBookmarks();
      return;
    }
    const res = await api.bookmarks.create({
      title: currentTitle && currentTitle !== 'Loading...' ? currentTitle : (currentDomain || currentUrl),
      url: currentUrl,
    });
    if (res.success) loadBookmarks();
  }, [api, currentUrl, currentTitle, currentDomain, bookmarks, loadBookmarks]);

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
      loadLoginEntries(currentDomain);
    }
  }, [entryToDelete, api, loadLoginEntries, currentDomain]);

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
    name: string; icon: string; scope: 'global' | 'private'; accountIds: string[];
  }) => {
    if (editingCategory) {
      await api.categories.update({
        id: editingCategory.id,
        name: draft.name,
        icon: draft.icon,
        scope: draft.scope,
        domain: draft.scope === 'private' ? (currentDomain || undefined) : undefined,
        accountIds: draft.accountIds,
      });
    } else {
      await api.categories.create({
        name: draft.name,
        icon: draft.icon,
        scope: draft.scope,
        domain: draft.scope === 'private' ? (currentDomain || undefined) : undefined,
        accountIds: draft.accountIds,
      });
    }
    setCategoryModalOpen(false);
    setEditingCategory(null);
    api.tabs.setOverlay(false);
    loadCategories(currentDomain);
  }, [editingCategory, api, currentDomain, loadCategories]);

  const handleDeleteCategory = useCallback(async (category: Category) => {
    const res = await api.categories.delete(category.id);
    if (res.success) {
      if (activeCategoryId === category.id) setActiveCategoryId(null);
      loadCategories(currentDomain);
    }
  }, [api, activeCategoryId, currentDomain, loadCategories]);

  // Filter the sidebar entries by the active category (null = show all).
  const visibleStatuses = React.useMemo(() => {
    if (!activeCategoryId) return domainStatuses;
    const cat = categories.find(c => c.id === activeCategoryId);
    if (!cat) return domainStatuses;
    const idSet = new Set(cat.accountIds);
    return domainStatuses.filter(s => idSet.has(s.entry.id));
  }, [activeCategoryId, categories, domainStatuses]);

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
          title={currentTitle}
          canGoBack={navigationState.canGoBack}
          canGoForward={navigationState.canGoForward}
          isLoading={navigationState.isLoading}
          onNavigate={handleNavigate}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onRefresh={handleRefresh}
          onAddBookmark={handleAddBookmark}
          isBookmarked={isCurrentBookmarked}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={handleOpenSettings}
        />

        {/* Bookmarks bar */}
        <BookmarksBar
          bookmarks={bookmarks}
          onNavigate={handleNavigate}
        />

        {/* Tab strip */}
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewGuestTab}
        />
      </div>

      {/* Content: Sidebar + Browser */}
      <div className="content-area">
        <Sidebar
          entries={visibleStatuses}
          currentDomain={currentDomain}
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

          {/* Settings tab — fills the browser area (view detached via overlay) */}
          {settingsOpen && (
            <SettingsPanel onClose={handleCloseSettings} />
          )}
        </div>
      </div>

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
              <input
                className="modal-input"
                type="password"
                placeholder="Enter password"
                value={modalData.password}
                onChange={e => setModalData(prev => ({ ...prev, password: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSaveNewEntry()}
              />
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
          accounts={loginEntries}
          currentDomain={currentDomain}
          onCancel={handleCloseCategoryModal}
          onSave={handleSaveCategory}
        />
      )}

    </div>
  );
}
