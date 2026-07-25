// ============================================================================
// Address Bar Component
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';
import ThemeToggle, { Theme } from './ThemeToggle';

interface AddressBarProps {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  /** Estimated page-load progress 0..1, or null when idle/hidden. */
  loadProgress?: number | null;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onRefresh: () => void;
  onAddBookmark: () => void;
  isBookmarked?: boolean;
  onSetLoginPage: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export default function AddressBar({
  url,
  canGoBack,
  canGoForward,
  isLoading,
  loadProgress = null,
  onNavigate,
  onGoBack,
  onGoForward,
  onRefresh,
  onAddBookmark,
  isBookmarked = false,
  onSetLoginPage,
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

      {/* Add-to-bookmark star button */}
      <button
        className={`bookmark-btn${isBookmarked ? ' active' : ''}`}
        onClick={onAddBookmark}
        disabled={!url || url === 'about:blank'}
        title={isBookmarked ? 'Bookmarked' : 'Add bookmark'}
      >
        {isBookmarked ? '★' : '☆'}
      </button>

      {/* Set-as-Login-Page button — immediately to the right of the star.
          Saves the current page as the login page for a chosen main website. */}
      <button
        className="login-page-btn"
        onClick={onSetLoginPage}
        disabled={!url || url === 'about:blank'}
        title="Set this page as a login page for a website"
        aria-label="Set as login page"
      >
        🔑
      </button>

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

      {/* App logo — pinned to the rightmost position (right of Settings).
          Light logo on the dark (night) theme, main logo on the light theme. */}
      <img
        className="app-logo"
        src={theme === 'light' ? './vault-browser-main.png' : './vault-browser-light.png'}
        alt="Vault Browser Desktop"
        title="Vault Browser Desktop"
        draggable={false}
      />

      {/* Page-load progress bar — light blue, stuck to the bottom edge of the
          address bar (directly under the URL input row). Hidden when idle. */}
      {loadProgress !== null && (
        <div className="load-progress-track" aria-hidden="true">
          <div
            className={`load-progress-fill${loadProgress >= 1 ? ' complete' : ''}`}
            style={{ width: `${Math.round(loadProgress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
