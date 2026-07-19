// ============================================================================
// Sidebar Component
// ============================================================================
// Shows all global login entries with their status for the current domain.
// Users can click on an entry to autofill on the current tab.

import React, { useState } from 'react';
import { LoginStatus } from '../../shared/types';

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
  onSelectEntry: (loginEntryId: string) => void;
  onAddEntry: () => void;
}

export default function Sidebar({ entries, currentDomain, onSelectEntry, onAddEntry }: SidebarProps) {
  const formatStatusLabel = (status: LoginStatus | null): string => {
    switch (status) {
      case 'logged_in': return 'Logged in';
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
    const now = Date.now();
    const remaining = until - now;

    if (remaining <= 0) return 'Expired';

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    if (minutes > 0) return `${minutes}m remaining`;
    return '< 1m';
  };

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">Vault</span>
        <button className="sidebar-add-btn" onClick={onAddEntry} title="Add login entry">
          +
        </button>
      </div>

      {/* Current domain indicator */}
      <div className="sidebar-domain-info">
        <div className="sidebar-domain-label">Current Site</div>
        <div className="sidebar-domain-value">
          {currentDomain ? (
            <span className="truncate" style={{ display: 'block' }}>{currentDomain}</span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>No page loaded</span>
          )}
        </div>
      </div>

      {/* Login entries */}
      <div className="sidebar-entries">
        {entries.length === 0 ? (
          <div style={{
            padding: '24px 12px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            <p>No saved logins yet.</p>
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
        ) : (
          entries.map(({ entry, status, statusInfo }) => {
            const badgeClass = status || 'never_used';

            return (
              <div
                key={entry.id}
                className="entry-item"
                onClick={() => onSelectEntry(entry.id)}
              >
                <div className="entry-item-header">
                  <span className="entry-label truncate">{entry.label}</span>
                  <span className={`status-badge ${badgeClass}`}>
                    {formatStatusLabel(status)}
                  </span>
                </div>

                <div className="entry-username truncate">
                  {entry.usernameOrEmail}
                </div>

                {/* Time remaining for logged_in status */}
                {status === 'logged_in' && statusInfo && (
                  <div style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}>
                    {formatTimeRemaining(statusInfo)}
                  </div>
                )}

                {/* Actions */}
                <div className="entry-actions">
                  <button
                    className="entry-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEntry(entry.id);
                    }}
                  >
                    {currentDomain ? 'Use on this site' : 'Select'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
