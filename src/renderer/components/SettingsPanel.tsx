// ============================================================================
// Settings Panel
// ============================================================================
// A full-shell settings surface opened from the address bar. Rendered above
// the browser view (the caller detaches the BrowserView via tabs.setOverlay).
//
// Sections:
//   1. Site account management — which sites have saved accounts and what they
//      are, with each account's per-site status.
//   2. Data management — clear the browser's cache / cookies / site storage.

import React, { useState, useEffect, useCallback } from 'react';
import { SiteAccountsGroup, LoginStatus } from '../../shared/types';
import { getApi } from '../api';

interface SettingsPanelProps {
  onClose: () => void;
}

type Section = 'accounts' | 'data';

const STATUS_LABEL: Record<LoginStatus, string> = {
  never_used: 'Never used',
  logged_in: 'Logged in',
  used: 'Used',
  expired: 'Expired',
  login_failed: 'Login failed',
  needs_2fa: 'Needs 2FA',
  active_tab_open: 'Active tab',
};

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const api = getApi();
  const [section, setSection] = useState<Section>('accounts');

  // ---- Site accounts ----
  const [groups, setGroups] = useState<SiteAccountsGroup[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    const res = await api.settings.siteAccounts();
    if (res.success && res.data) setGroups(res.data);
    setAccountsLoading(false);
  }, [api]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ---- Data management ----
  const [clearCache, setClearCache] = useState(true);
  const [clearCookies, setClearCookies] = useState(true);
  const [clearStorage, setClearStorage] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const handleClearData = useCallback(async () => {
    setClearing(true);
    setClearResult(null);
    const res = await api.settings.clearData({
      cache: clearCache,
      cookies: clearCookies,
      storage: clearStorage,
    });
    setClearing(false);
    if (res.success && res.data) {
      setClearResult(
        res.data.cleared.length
          ? `Cleared: ${res.data.cleared.join(', ')}.`
          : 'Nothing selected to clear.'
      );
    } else {
      setClearResult(`Failed to clear data: ${res.error || 'unknown error'}`);
    }
  }, [api, clearCache, clearCookies, clearStorage]);

  const totalAccounts = groups.reduce((n, g) => n + g.accounts.length, 0);

  return (
    <div className="settings-panel" role="dialog" aria-label="Settings">
      <header className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <button className="settings-close-btn" onClick={onClose} title="Close settings" aria-label="Close settings">
          ✕
        </button>
      </header>

      <div className="settings-body">
        {/* Left nav */}
        <nav className="settings-nav" aria-label="Settings sections">
          <button
            className={`settings-nav-item${section === 'accounts' ? ' active' : ''}`}
            onClick={() => setSection('accounts')}
          >
            <span className="settings-nav-icon">🔑</span> Site accounts
          </button>
          <button
            className={`settings-nav-item${section === 'data' ? ' active' : ''}`}
            onClick={() => setSection('data')}
          >
            <span className="settings-nav-icon">🧹</span> Data management
          </button>
        </nav>

        {/* Content */}
        <section className="settings-content">
          {section === 'accounts' && (
            <div id="settings-accounts">
              <h2 className="settings-section-title">Site account management</h2>
              <p className="settings-section-desc">
                Sites with saved accounts and their per-site status.
                {' '}<strong>{totalAccounts}</strong> account{totalAccounts === 1 ? '' : 's'} across{' '}
                <strong>{groups.length}</strong> {groups.length === 1 ? 'group' : 'groups'}.
              </p>

              {accountsLoading ? (
                <div className="settings-empty">Loading…</div>
              ) : groups.length === 0 ? (
                <div className="settings-empty">No saved accounts yet.</div>
              ) : (
                <div className="site-groups">
                  {groups.map(group => (
                    <div key={group.domain || '(unscoped)'} className="site-group">
                      <div className="site-group-header">
                        <span className="site-group-domain">
                          {group.domain || 'Unscoped / legacy accounts'}
                        </span>
                        <span className="site-group-count">{group.accounts.length}</span>
                      </div>
                      <ul className="site-account-list">
                        {group.accounts.map(acc => (
                          <li key={acc.loginEntryId} className="site-account-row">
                            <span className="site-account-label">{acc.label}</span>
                            <span className="site-account-user">{acc.usernameOrEmail}</span>
                            <span className={`status-badge ${acc.status}`}>
                              {STATUS_LABEL[acc.status] || acc.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'data' && (
            <div id="settings-data">
              <h2 className="settings-section-title">Data management</h2>
              <p className="settings-section-desc">
                Clear the browser's cache and stored data. This does not delete
                your saved accounts — only cached files, cookies and site
                storage.
              </p>

              <div className="clear-options">
                <label className="clear-option">
                  <input type="checkbox" checked={clearCache} onChange={e => setClearCache(e.target.checked)} />
                  <span><strong>Cache</strong> — cached files and images</span>
                </label>
                <label className="clear-option">
                  <input type="checkbox" checked={clearCookies} onChange={e => setClearCookies(e.target.checked)} />
                  <span><strong>Cookies</strong> — sign-in cookies for websites</span>
                </label>
                <label className="clear-option">
                  <input type="checkbox" checked={clearStorage} onChange={e => setClearStorage(e.target.checked)} />
                  <span><strong>Site storage</strong> — localStorage, IndexedDB, service workers</span>
                </label>
              </div>

              <button
                className="modal-btn danger"
                onClick={handleClearData}
                disabled={clearing || (!clearCache && !clearCookies && !clearStorage)}
              >
                {clearing ? 'Clearing…' : 'Clear selected data'}
              </button>

              {clearResult && (
                <div className="clear-result" role="status">{clearResult}</div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
