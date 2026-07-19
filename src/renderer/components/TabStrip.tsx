// ============================================================================
// Tab Strip Component
// ============================================================================

import React from 'react';
import { TabInfo } from '../../shared/types';

interface TabStripProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export default function TabStrip({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
}: TabStripProps) {
  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      onCloseTab(tabId);
    }
  };

  return (
    <div className="tab-strip">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const displayTitle = tab.type === 'guest'
          ? 'New Tab'
          : (tab.currentUrl ? truncateUrl(tab.currentUrl) : 'Loading...');
        const maxTitleLength = 25;

        return (
          <div
            key={tab.id}
            className={`tab-item${isActive ? ' active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
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
