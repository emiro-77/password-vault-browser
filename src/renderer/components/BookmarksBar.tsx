// ============================================================================
// Bookmarks Bar Component
// ============================================================================

import React from 'react';
import { Bookmark } from '../../shared/types';

interface BookmarksBarProps {
  bookmarks: Bookmark[];
  onNavigate: (url: string) => void;
}

export default function BookmarksBar({ bookmarks, onNavigate }: BookmarksBarProps) {
  if (bookmarks.length === 0) {
    return (
      <div className="bookmarks-bar">
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          No bookmarks yet
        </span>
      </div>
    );
  }

  return (
    <div className="bookmarks-bar">
      {bookmarks.map(bm => (
        <button
          key={bm.id}
          className="bookmark-item"
          onClick={() => onNavigate(bm.url)}
          title={bm.url}
        >
          <span className="truncate" style={{ maxWidth: 180 }}>
            {bm.title || bm.url}
          </span>
        </button>
      ))}
    </div>
  );
}
