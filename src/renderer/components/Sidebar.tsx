// ============================================================================
// Sidebar Component
// ============================================================================
// Shows the login entries for the current site with their per-site status.
// Supports:
//   - expanded / minimized (collapsed) modes
//   - a category bar at the bottom (add / select / right-click edit-delete)
//     with horizontal drag-scroll for overflow
//   - filtering the visible accounts by the active category

import React, { useRef, useState, useCallback } from 'react';
import { LoginStatus, Category, LoginConnection } from '../../shared/types';

interface EntryWithStatus {
  entry: { id: string; label: string; usernameOrEmail: string };
  status: LoginStatus | null;
  statusInfo: {
    id: string;
    loggedInUntil: string | null;
    firstLoginAt: string | null;
    lastUsedAt: string | null;
    activeTabId: string | null;
  } | null;
}

interface SidebarProps {
  entries: EntryWithStatus[];
  currentDomain: string | null;
  connection: LoginConnection | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectEntry: (loginEntryId: string) => void;
  onAddEntry: () => void;
  onDeleteEntry: (loginEntryId: string) => void;

  // Categories
  categories: Category[];
  activeCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
}

const ACTIVE_STATUSES: LoginStatus[] = ['logged_in', 'active_tab_open'];

export default function Sidebar({
  entries,
  currentDomain,
  connection,
  collapsed,
  onToggleCollapse,
  onSelectEntry,
  onAddEntry,
  onDeleteEntry,
  categories,
  activeCategoryId,
  onSelectCategory,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
}: SidebarProps) {
  const formatStatusLabel = (status: LoginStatus | null): string => {
    switch (status) {
      case 'logged_in': return 'Logged in';
      case 'used': return 'Used';
      case 'expired': return 'Expired';
      case 'never_used': return 'Never used';
      case 'login_failed': return 'Login failed';
      case 'needs_2fa': return 'Needs 2FA';
      case 'active_tab_open': return 'Active tab';
      default: return 'Unknown';
    }
  };

  const formatTimeRemaining = (statusInfo: EntryWithStatus['statusInfo']): string | null => {
    if (!statusInfo?.loggedInUntil) return null;
    const until = new Date(statusInfo.loggedInUntil).getTime();
    const remaining = until - Date.now();
    if (remaining <= 0) return 'Expired';
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    if (minutes > 0) return `${minutes}m remaining`;
    return '< 1m';
  };

  const isActive = (status: LoginStatus | null) => !!status && ACTIVE_STATUSES.includes(status);

  // ---- Category context menu ----
  // The menu is anchored ABOVE the clicked category chip (categories live at
  // the bottom of the sidebar, so a downward menu would slide under the OS
  // taskbar). We capture the chip's bounding rect and pin the menu's bottom
  // edge just above the chip's top edge.
  const [menu, setMenu] = useState<{ left: number; bottom: number; category: Category } | null>(null);

  const openMenu = (e: React.MouseEvent, category: Category) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const MENU_WIDTH = 180; // must be >= .category-context-menu min-width
    // Align the menu's left edge with the chip, but clamp so it never spills
    // past the right viewport edge.
    const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8);
    setMenu({
      left: Math.max(8, left),
      // Distance from the viewport bottom up to the top of the chip, plus a
      // small gap — CSS uses `bottom` so the menu grows upward.
      bottom: window.innerHeight - rect.top + 6,
      category,
    });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  // ---- Horizontal drag-scroll for the category bar overflow ----
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startScroll: number; dragging: boolean }>({
    startX: 0, startScroll: 0, dragging: false,
  });

  const onScrollerMouseDown = (e: React.MouseEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = { startX: e.clientX, startScroll: el.scrollLeft, dragging: true };
  };
  const onScrollerMouseMove = (e: React.MouseEvent) => {
    const el = scrollerRef.current;
    if (!el || !drag.current.dragging) return;
    el.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX);
  };
  const endDrag = () => { drag.current.dragging = false; };
  const onScrollerWheel = (e: React.WheelEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft += e.deltaY;
  };

  return (
    <div
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
      onClick={closeMenu}
    >
      {/* Header */}
      <div className="sidebar-header">
        {!collapsed && <span className="sidebar-title">Vault</span>}
        <div className="sidebar-header-actions">
          {!collapsed && (
            <button className="sidebar-add-btn" onClick={onAddEntry} title="Add login entry">
              +
            </button>
          )}
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
      </div>

      {/* Current-site indicator (expanded only). The view adapts to the 3
          login-page scenarios:
            A 'login'      — this page IS a saved login page
            B 'connected'  — main/related URL linked to a login page
            C 'standalone' — no login-page association (default). */}
      {!collapsed && (() => {
        const scenario = connection?.scenario ?? 'standalone';

        if (scenario === 'login') {
          return (
            <div className="sidebar-domain-info scenario-login" aria-label="Login page">
              <div className="sidebar-domain-label">
                <span className="scenario-badge login">🔑 Login Page</span>
              </div>
              <div className="sidebar-domain-value">
                <span className="truncate" style={{ display: 'block' }}>{currentDomain}</span>
              </div>
              <div className="scenario-hint">
                Enter credentials here. Accounts are shared with{' '}
                <strong>{connection?.mainDomain || 'the main site'}</strong> and its related pages.
              </div>
            </div>
          );
        }

        if (scenario === 'connected') {
          const related = connection?.relatedUrls ?? [];
          return (
            <div className="sidebar-domain-info scenario-connected" aria-label="Connected site">
              <div className="sidebar-domain-label">
                <span className="scenario-badge connected">🔗 Connected Site</span>
              </div>
              <div className="sidebar-domain-value">
                <span className="truncate" style={{ display: 'block' }}>{currentDomain}</span>
              </div>
              <div className="scenario-hint">
                Linked to login page{' '}
                <strong>{connection?.loginDomain || connection?.loginUrl}</strong>.
                Selecting an account opens it and signs in automatically.
              </div>
              {related.length > 0 && (
                <div className="scenario-related" title={related.join('\n')}>
                  {related.length} related URL{related.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
          );
        }

        // Scenario C — standalone / unconnected (default).
        return (
          <div className="sidebar-domain-info scenario-standalone">
            <div className="sidebar-domain-label">Current Site</div>
            <div className="sidebar-domain-value">
              {currentDomain ? (
                <span className="truncate" style={{ display: 'block' }}>{currentDomain}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>No page loaded</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Login entries */}
      <div className="sidebar-entries">
        {entries.length === 0 ? (
          collapsed ? null : (
            <div className="sidebar-empty">
              <p>No saved logins {activeCategoryId ? 'in this category' : 'yet'}.</p>
              <p style={{ marginTop: 8 }}>
                <button
                  className="modal-btn primary"
                  onClick={onAddEntry}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                >
                  + Add Login
                </button>
              </p>
            </div>
          )
        ) : collapsed ? (
          // ---- Minimized mode: only labels for accounts whose status is
          //      "never used" or "active tab" (the single active account).
          //      Active = green, never-used = white. "Used" accounts are
          //      hidden here (per spec). ----
          entries
            .filter(({ status }) => status === 'active_tab_open' || status === 'never_used' || status === null)
            .map(({ entry, status }) => (
              <button
                key={entry.id}
                className={`entry-mini${status === 'active_tab_open' ? ' active' : ''}`}
                title={entry.label}
                onClick={() => onSelectEntry(entry.id)}
              >
                {entry.label}
              </button>
            ))
        ) : (
          // ---- Expanded mode: full details ----
          entries.map(({ entry, status, statusInfo }) => {
            const badgeClass = status || 'never_used';
            return (
              <div key={entry.id} className="entry-item" onClick={() => onSelectEntry(entry.id)}>
                <div className="entry-item-header">
                  <span className="entry-label truncate">{entry.label}</span>
                  <span className={`status-badge ${badgeClass}`}>
                    {formatStatusLabel(status)}
                  </span>
                  <button
                    className="entry-delete-btn"
                    title="Delete account"
                    onClick={(e) => { e.stopPropagation(); onDeleteEntry(entry.id); }}
                  >
                    ✕
                  </button>
                </div>

                <div className="entry-username truncate">{entry.usernameOrEmail}</div>

                {(status === 'active_tab_open' || status === 'used') && statusInfo?.loggedInUntil && (
                  <div className="entry-time-remaining">{formatTimeRemaining(statusInfo)}</div>
                )}

                <div className="entry-actions">
                  <button
                    className="entry-action-btn"
                    onClick={(e) => { e.stopPropagation(); onSelectEntry(entry.id); }}
                  >
                    {currentDomain ? 'Use on this site' : 'Select'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ---- Category bar (bottom) ---- */}
      {!collapsed && (
        <div className="category-bar">
          <div
            className="category-scroller"
            ref={scrollerRef}
            onMouseDown={onScrollerMouseDown}
            onMouseMove={onScrollerMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onWheel={onScrollerWheel}
          >
            <button
              className={`category-chip${activeCategoryId === null ? ' active' : ''}`}
              onClick={() => onSelectCategory(null)}
              title="All accounts"
            >
              <span className="category-chip-icon">🗂️</span>
              <span className="category-chip-name">All</span>
            </button>

            {categories.map(cat => (
              <button
                key={cat.id}
                className={`category-chip${activeCategoryId === cat.id ? ' active' : ''}`}
                onClick={() => onSelectCategory(cat.id)}
                onContextMenu={(e) => openMenu(e, cat)}
                title={`${cat.name}${cat.scope === 'private' ? ' (private)' : ''}`}
              >
                <span className="category-chip-icon">
                  {cat.icon.startsWith('data:')
                    ? <img src={cat.icon} alt="" className="category-chip-img" />
                    : cat.icon}
                </span>
                <span className="category-chip-name">{cat.name}</span>
                {cat.scope === 'private' && <span className="category-chip-lock">🔒</span>}
              </button>
            ))}
          </div>

          <button className="category-add-btn" onClick={onAddCategory} title="New category">
            📁＋
          </button>
        </div>
      )}

      {/* ---- Category context menu ---- */}
      {menu && (
        <div
          className="category-context-menu"
          style={{ left: menu.left, bottom: menu.bottom }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { onEditCategory(menu.category); closeMenu(); }}>
            ✏️ Edit category
          </button>
          <button className="danger" onClick={() => { onDeleteCategory(menu.category); closeMenu(); }}>
            🗑️ Delete category
          </button>
        </div>
      )}
    </div>
  );
}
