// ============================================================================
// Address Bar Component
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';
import ThemeToggle, { Theme } from './ThemeToggle';

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
  onAddBookmark: () => void;
  isBookmarked?: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
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
  onAddBookmark,
  isBookmarked = false,
  theme,
  onToggleTheme,
  onOpenSettings,
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
      <span className="page-title-indicator">
        {title}
      </span>

      {/* Add-to-bookmark star button */}
      <button
        className={`bookmark-btn${isBookmarked ? ' active' : ''}`}
        onClick={onAddBookmark}
        disabled={!url || url === 'about:blank'}
        title={isBookmarked ? 'Bookmarked' : 'Add bookmark'}
      >
        {isBookmarked ? '★' : '☆'}
      </button>

      {/* App name */}
      <span className="app-name" title="Password Vault Browser">Vault Browser</span>

      {/* Light / Night theme toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />

      {/* Settings button */}
      <button
        className="settings-btn"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Open settings"
      >
        ⚙
      </button>
    </div>
  );
}
