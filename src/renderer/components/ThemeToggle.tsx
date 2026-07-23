// ============================================================================
// Theme Toggle Component
// ============================================================================
// A small button (placed in the top bar, right section) that switches the
// whole UI between Light Mode and Night Mode.

import React from 'react';

export type Theme = 'light' | 'dark';

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === 'dark';
  return (
    <button
      className="theme-toggle-btn"
      onClick={onToggle}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Night Mode'}
      aria-label="Toggle theme"
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
