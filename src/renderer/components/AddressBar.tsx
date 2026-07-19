// ============================================================================
// Address Bar Component
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';

interface AddressBarProps {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onRefresh: () => void;
  onNewTab: () => void;
}

export default function AddressBar({
  url,
  title,
  canGoBack,
  canGoForward,
  isLoading,
  onNavigate,
  onGoBack,
  onGoForward,
  onRefresh,
  onNewTab,
}: AddressBarProps) {
  const [inputValue, setInputValue] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep input in sync with URL changes from navigation
  useEffect(() => {
    setInputValue(url === 'about:blank' ? '' : url);
  }, [url]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = inputValue.trim();
      if (value) {
        onNavigate(value);
      }
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    // Select all text on focus for easy replacement
    inputRef.current?.select();
  };

  return (
    <div className="address-bar">
      {/* Back button */}
      <button
        className="nav-btn"
        onClick={onGoBack}
        disabled={!canGoBack}
        title="Go back"
      >
        ◀
      </button>

      {/* Forward button */}
      <button
        className="nav-btn"
        onClick={onGoForward}
        disabled={!canGoForward}
        title="Go forward"
      >
        ▶
      </button>

      {/* Refresh / Stop button */}
      <button
        className="nav-btn"
        onClick={onRefresh}
        title={isLoading ? 'Stop' : 'Reload'}
      >
        {isLoading ? '✕' : '⟳'}
      </button>

      {/* URL input */}
      <input
        ref={inputRef}
        className="url-input"
        type="text"
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder="Search or enter URL..."
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />

      {/* Page title indicator */}
      <span style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        maxWidth: 150,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {title}
      </span>

      {/* New tab button */}
      <button
        className="new-tab-btn"
        onClick={onNewTab}
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
