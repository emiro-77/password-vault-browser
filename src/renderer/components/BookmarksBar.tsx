// ============================================================================
// Bookmarks Bar Component
// ============================================================================

import React, { useMemo } from 'react';
import { Bookmark } from '../../shared/types';

interface BookmarksBarProps {
  bookmarks: Bookmark[];
  onNavigate: (url: string) => void;
  onRemove: (bookmark: Bookmark) => void;
  /**
   * Open a folder's contents. The parent shows them as a NATIVE dropdown menu
   * (an Electron Menu popped up by the main process) which always renders above
   * the web view — so no BrowserView detach, no page flash / reload.
   */
  onOpenFolder?: (items: Bookmark[], anchor: { x: number; y: number }) => void;
}

export default function BookmarksBar({ bookmarks, onNavigate, onRemove, onOpenFolder }: BookmarksBarProps) {
  // Split bookmarks into top-level (no folder) and grouped-by-folder buckets.
  const { topLevel, folders } = useMemo(() => {
    const top: Bookmark[] = [];
    const byFolder = new Map<string, Bookmark[]>();
    for (const bm of bookmarks) {
      const folder = bm.folder || '';
      if (folder === '') {
        top.push(bm);
      } else {
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder)!.push(bm);
      }
    }
    const folderList = Array.from(byFolder.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => ({ name, items }));
    return { topLevel: top, folders: folderList };
  }, [bookmarks]);

  if (bookmarks.length === 0) {
    return (
      <div className="bookmarks-bar">
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          No bookmarks yet
        </span>
      </div>
    );
  }

  // Pop the native folder menu just below the clicked folder button.
  const handleFolderClick = (e: React.MouseEvent, items: Bookmark[]) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onOpenFolder?.(items, { x: Math.round(rect.left), y: Math.round(rect.bottom) });
  };

  const renderBookmark = (bm: Bookmark) => (
    <div key={bm.id} className="bookmark-item-wrap">
      <button
        className="bookmark-item"
        onClick={() => onNavigate(bm.url)}
        title={bm.url}
      >
        <span className="truncate" style={{ maxWidth: 160 }}>
          {bm.title || bm.url}
        </span>
      </button>
      <button
        className="bookmark-remove-btn"
        title="Remove bookmark"
        aria-label={`Remove ${bm.title || bm.url}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(bm);
        }}
      >
        ×
      </button>
    </div>
  );

  return (
    <div className="bookmarks-bar">
      {/* Folder dropdowns first — opened as native menus */}
      {folders.map(folder => (
        <div key={folder.name} className="bookmark-folder">
          <button
            className="bookmark-folder-btn"
            onClick={(e) => handleFolderClick(e, folder.items)}
            title={folder.name}
          >
            <span className="bookmark-folder-icon">📁</span>
            <span className="truncate" style={{ maxWidth: 120 }}>{folder.name}</span>
            <span className="bookmark-folder-caret">▾</span>
          </button>
        </div>
      ))}

      {/* Top-level (unfoldered) bookmarks */}
      {topLevel.map(renderBookmark)}
    </div>
  );
}
