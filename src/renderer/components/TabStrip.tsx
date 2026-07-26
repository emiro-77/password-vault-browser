// ============================================================================
// Tab Strip Component
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { TabInfo } from '../../shared/types';

interface TabStripProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onDuplicateTab?: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onReloadTab?: (tabId: string) => void;
}

interface TabMenuState {
  tabId: string;
  x: number;
  y: number;
}

export default function TabStrip({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
  onDuplicateTab,
  onCloseOtherTabs,
  onReloadTab,
}: TabStripProps) {
  const [menu, setMenu] = useState<TabMenuState | null>(null);

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      onCloseTab(tabId);
    }
  };

  const openMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  // Dismiss the context menu on any outside click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('click', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, closeMenu]);

  const menuTab = menu ? tabs.find(t => t.id === menu.tabId) : null;
  const hasPage = !!(menuTab && menuTab.currentUrl && menuTab.currentUrl !== 'about:blank');

  return (
    <div className="tab-strip">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const hasTabPage = tab.currentUrl && tab.currentUrl !== 'about:blank';
        // Prefer the live page title; fall back to the site host from the URL;
        // only show "New Tab" when nothing has been loaded yet.
        const displayTitle = tab.title && tab.title.trim()
          ? tab.title.trim()
          : hasTabPage
            ? truncateUrl(tab.currentUrl)
            : 'New Tab';
        const maxTitleLength = 25;

        return (
          <div
            key={tab.id}
            className={`tab-item${isActive ? ' active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
            onContextMenu={(e) => openMenu(e, tab.id)}
            draggable={false}
          >
            <span className={`tab-type-badge${tab.type === 'login_entry' ? ' login' : ''}`}>
              {tab.type === 'login_entry' ? '🔐' : '👤'}
            </span>

            <span className="tab-title">
              {displayTitle.length > maxTitleLength
                ? displayTitle.substring(0, maxTitleLength) + '…'
                : displayTitle}
            </span>

            <button
              className="tab-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title="Close tab"
            >
              ✕
            </button>
          </div>
        );
      })}

      {/* New tab button at end of strip */}
      <button
        className="new-tab-btn"
        onClick={onNewTab}
        title="New tab"
        style={{
          flexShrink: 0,
          marginLeft: 4,
          width: 28,
          height: 28,
        }}
      >
        +
      </button>

      {/* Right-click context menu for a tab */}
      {menu && menuTab && (
        <div
          className="tab-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            className="tab-context-item"
            onClick={() => { onReloadTab?.(menu.tabId); closeMenu(); }}
            disabled={!hasPage || !onReloadTab}
          >
            Reload
          </button>
          <button
            className="tab-context-item"
            onClick={() => { onDuplicateTab?.(menu.tabId); closeMenu(); }}
            disabled={!hasPage || !onDuplicateTab}
          >
            Duplicate Tab
          </button>
          <div className="tab-context-sep" />
          <button
            className="tab-context-item"
            onClick={() => { onNewTab(); closeMenu(); }}
          >
            New Tab
          </button>
          <div className="tab-context-sep" />
          <button
            className="tab-context-item"
            onClick={() => { onCloseTab(menu.tabId); closeMenu(); }}
          >
            Close Tab
          </button>
          <button
            className="tab-context-item"
            onClick={() => { onCloseOtherTabs?.(menu.tabId); closeMenu(); }}
            disabled={tabs.length <= 1 || !onCloseOtherTabs}
          >
            Close Other Tabs
          </button>
        </div>
      )}
    </div>
  );
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let display = parsed.hostname.replace(/^www\./, '');
    if (parsed.pathname && parsed.pathname !== '/') {
      display += parsed.pathname.substring(0, 20);
    }
    return display;
  } catch {
    return url;
  }
}
