// ============================================================================
// Password Vault Browser — Main App Component
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import AddressBar from './components/AddressBar';
import BookmarksBar from './components/BookmarksBar';
import Sidebar from './components/Sidebar';
import TabStrip from './components/TabStrip';
import { LoginEntry, Bookmark, SiteLoginStatus, TabInfo, LoginStatus } from '../shared/types';
import { SIDEBAR_WIDTH } from '../shared/constants';
import { WebviewTag } from './types.d';

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

  const contentRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);

  const api = window.pvbAPI;

  // ---- Data loading ----

  const loadLoginEntries = useCallback(async () => {
    const res = await api.credentials.list();
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
    await Promise.all([loadLoginEntries(), loadBookmarks()]);
  }, [loadLoginEntries, loadBookmarks]);

  // ---- Initial load ----

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

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

  const handleNavigate = useCallback(async (url: string) => {
    await api.tabs.navigate(url);
    setCurrentUrl(url);

    // Extract domain
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
      setCurrentDomain(domain);
    } catch {
      setCurrentDomain(null);
    }
  }, [api]);

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
      if (data.tabId === activeTabId) {
        setCurrentTitle(data.title);
      }
    });

    const unsub3 = api.on('event:nav-state-changed', (data: any) => {
      if (data.tabId === activeTabId) {
        setNavigationState(prev => ({
          ...prev,
          isLoading: data.isLoading,
        }));
      }
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [api, activeTabId]);

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

  const handleOpenAddEntryModal = useCallback(() => {
    setModalData({ label: '', usernameOrEmail: '', password: '' });
    setShowAddEntryModal(true);
  }, []);

  const handleCloseAddEntryModal = useCallback(() => {
    setShowAddEntryModal(false);
  }, []);

  const handleSaveNewEntry = useCallback(async () => {
    if (!modalData.label || !modalData.usernameOrEmail || !modalData.password) return;

    const res = await api.credentials.create({
      label: modalData.label,
      usernameOrEmail: modalData.usernameOrEmail,
      password: modalData.password,
    });

    if (res.success) {
      setShowAddEntryModal(false);
      loadLoginEntries();
    }
  }, [modalData, api, loadLoginEntries]);

  // ---- Render ----

  return (
    <div className="app-layout">
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
          onNewTab={handleNewGuestTab}
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
          entries={domainStatuses}
          currentDomain={currentDomain}
          onSelectEntry={handleSelectLoginEntry}
          onAddEntry={handleOpenAddEntryModal}
        />

        <div className="browser-area" ref={contentRef}>
          {!activeTabId && (
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

      {/* Add Login Entry Modal */}
      {showAddEntryModal && (
        <div className="modal-overlay" onClick={handleCloseAddEntryModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Add Login Entry</div>

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
    </div>
  );
}
