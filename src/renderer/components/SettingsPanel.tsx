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
import { SiteAccountsGroup, SiteAccountInfo, LoginStatus, LoginPageMapping, Category } from '../../shared/types';
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

// Statuses a user may assign manually from the edit dialog. 'active_tab_open'
// is intentionally excluded — it is set only by opening a live tab.
const ASSIGNABLE_STATUSES: LoginStatus[] = [
  'never_used', 'logged_in', 'used', 'expired', 'login_failed', 'needs_2fa',
];

/** Format the remaining time in the 24h window as e.g. "1h 05m" / "12m". */
function formatTimeRemaining(loggedInUntil: string | null): string | null {
  if (!loggedInUntil) return null;
  const remaining = new Date(loggedInUntil).getTime() - Date.now();
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return '< 1m';
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const api = getApi();
  const [section, setSection] = useState<Section>('accounts');

  // ---- Site accounts ----
  const [groups, setGroups] = useState<SiteAccountsGroup[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  // Filter: show all sites, or only sites that are saved login pages.
  const [siteFilter, setSiteFilter] = useState<'all' | 'login'>('all');
  // Free-text search over site (domain) and account email/label (#4).
  const [search, setSearch] = useState('');
  // Collapsed site groups (by domain key). Collapsed = minimized section (#4).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The login-page mapping being edited in-place (Settings editor), or null.
  const [editingMapping, setEditingMapping] = useState<LoginPageMapping | null>(null);

  const groupKey = (g: SiteAccountsGroup) => g.domain || '(unscoped)';

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    const res = await api.settings.siteAccounts();
    if (res.success && res.data) setGroups(res.data);
    setAccountsLoading(false);
  }, [api]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loginSiteCount = groups.filter(g => g.loginMapping).length;

  // Apply the login-site filter first, then the free-text search (#4). A group
  // matches if its domain contains the query OR it has ≥1 account whose
  // email/username or label matches. When only accounts match, the group is
  // narrowed to just those accounts; when the domain itself matches, all its
  // accounts are kept.
  const visibleGroups = React.useMemo(() => {
    const base = siteFilter === 'login' ? groups.filter(g => g.loginMapping) : groups;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const out: SiteAccountsGroup[] = [];
    for (const g of base) {
      const domainMatch = (g.domain || 'unscoped').toLowerCase().includes(q);
      if (domainMatch) {
        out.push(g);
        continue;
      }
      const matchedAccounts = g.accounts.filter(a =>
        a.usernameOrEmail.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q)
      );
      if (matchedAccounts.length > 0) {
        out.push({ ...g, accounts: matchedAccounts });
      }
    }
    return out;
  }, [groups, siteFilter, search]);

  // ---- Edit / delete account ----
  // The row being edited (account + its site domain), or null when closed.
  const [editing, setEditing] = useState<{ account: SiteAccountInfo; domain: string } | null>(null);

  const handleDeleteAccount = useCallback(async (acc: SiteAccountInfo) => {
    const ok = window.confirm(
      `Delete the account "${acc.label}" (${acc.usernameOrEmail})?\n\n` +
      `This permanently removes the saved credential and its status/timer data.`
    );
    if (!ok) return;
    const res = await api.credentials.delete(acc.loginEntryId);
    if (!res.success) {
      window.alert(`Failed to delete account: ${res.error || 'unknown error'}`);
      return;
    }
    await loadAccounts();
  }, [api, loadAccounts]);

  // ---- Data management ----
  const [clearCache, setClearCache] = useState(true);
  const [clearCookies, setClearCookies] = useState(true);
  const [clearStorage, setClearStorage] = useState(true);
  // Vault wipe is destructive, so it defaults OFF and must be opted into.
  const [clearVault, setClearVault] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const handleClearData = useCallback(async () => {
    // Wiping the vault is irreversible — confirm before proceeding.
    if (clearVault) {
      const ok = window.confirm(
        'This will permanently delete ALL saved accounts (and their passwords), ' +
        'bookmarks, saved login pages, per-site status and categories. This cannot ' +
        'be undone. Continue?'
      );
      if (!ok) return;
    }

    setClearing(true);
    setClearResult(null);
    const res = await api.settings.clearData({
      cache: clearCache,
      cookies: clearCookies,
      storage: clearStorage,
      vault: clearVault,
    });
    setClearing(false);
    if (res.success && res.data) {
      setClearResult(
        res.data.cleared.length
          ? `Cleared: ${res.data.cleared.join(', ')}.`
          : 'Nothing selected to clear.'
      );
      // Refresh the Site accounts list so wiped accounts disappear immediately.
      if (clearVault) {
        setClearVault(false);
        await loadAccounts();
      }
    } else {
      setClearResult(`Failed to clear data: ${res.error || 'unknown error'}`);
    }
  }, [api, clearCache, clearCookies, clearStorage, clearVault, loadAccounts]);

  // ---- Data export / import (encrypted backup) ----
  const [transferMode, setTransferMode] = useState<null | 'export' | 'import'>(null);
  const [transferResult, setTransferResult] = useState<string | null>(null);

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

              {/* Filter: All Sites / Login Sites */}
              <div className="site-filter" role="tablist" aria-label="Filter sites">
                <button
                  role="tab"
                  aria-selected={siteFilter === 'all'}
                  className={`site-filter-btn${siteFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setSiteFilter('all')}
                >
                  All Sites <span className="site-filter-count">{groups.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={siteFilter === 'login'}
                  className={`site-filter-btn${siteFilter === 'login' ? ' active' : ''}`}
                  onClick={() => setSiteFilter('login')}
                >
                  🔑 Login Sites <span className="site-filter-count">{loginSiteCount}</span>
                </button>
              </div>

              {/* Search bar (#4): filter by site name or account email/label. */}
              <div className="site-search">
                <span className="site-search-icon" aria-hidden="true">🔍</span>
                <input
                  className="site-search-input"
                  type="search"
                  placeholder="Search sites or emails…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label="Search sites or account emails"
                />
                {search && (
                  <button
                    className="site-search-clear"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              {accountsLoading ? (
                <div className="settings-empty">Loading…</div>
              ) : visibleGroups.length === 0 ? (
                <div className="settings-empty">
                  {siteFilter === 'login' ? 'No saved login pages yet.' : 'No saved accounts yet.'}
                </div>
              ) : (
                <div className="site-groups">
                  {visibleGroups.map(group => {
                    const key = groupKey(group);
                    // While searching, force groups open so matches are visible.
                    const isCollapsed = !search.trim() && collapsed.has(key);
                    return (
                    <div
                      key={key}
                      className={`site-group${group.loginMapping ? ' is-login-site' : ''}${isCollapsed ? ' is-collapsed' : ''}`}
                    >
                      <div className="site-group-header">
                        <button
                          className="site-group-toggle"
                          onClick={() => toggleCollapsed(key)}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? `Expand ${group.domain || 'unscoped'}` : `Collapse ${group.domain || 'unscoped'}`}
                          title={isCollapsed ? 'Expand' : 'Collapse'}
                        >
                          <span className="site-group-caret">{isCollapsed ? '▸' : '▾'}</span>
                          <span className="site-group-domain">
                            {group.loginMapping && <span className="login-site-badge" title="Saved login page">🔑</span>}
                            {group.domain || 'Unscoped / legacy accounts'}
                          </span>
                        </button>
                        <span className="site-group-header-right">
                          {group.openTabCount > 0 && (
                            <span
                              className="site-group-open-tabs"
                              title={`${group.openTabCount} browser tab${group.openTabCount === 1 ? '' : 's'} currently open on this site`}
                            >
                              🗔 {group.openTabCount} open tab{group.openTabCount === 1 ? '' : 's'}
                            </span>
                          )}
                          <span className="site-group-count">{group.accounts.length}</span>
                          {group.loginMapping && (
                            <button
                              className="site-account-action-btn site-group-edit-btn"
                              title="Edit login-page mapping"
                              aria-label={`Edit login-page mapping for ${group.domain}`}
                              onClick={() => setEditingMapping(group.loginMapping!)}
                            >
                              ✎ Edit
                            </button>
                          )}
                        </span>
                      </div>

                      {!isCollapsed && (<>
                      {/* Visual mapping: main URL + related URLs (with overflow). */}
                      {group.loginMapping && (
                        <MappingUrls mapping={group.loginMapping} />
                      )}
                      <ul className="site-account-list">
                        {group.accounts.map(acc => {
                          const remaining = formatTimeRemaining(acc.loggedInUntil);
                          return (
                            <li key={acc.loginEntryId} className="site-account-row">
                              <span className="site-account-label">{acc.label}</span>
                              <span className="site-account-user">{acc.usernameOrEmail}</span>
                              {/* Time remaining sits to the LEFT of the status. */}
                              <span className="site-account-remaining" title={remaining ? '24h window remaining' : 'No active timer'}>
                                {remaining ? `⏳ ${remaining}` : ''}
                              </span>
                              <span className={`status-badge ${acc.status}`}>
                                {STATUS_LABEL[acc.status] || acc.status}
                              </span>
                              <span className="site-account-actions">
                                <button
                                  className="site-account-action-btn"
                                  title="Edit account"
                                  aria-label={`Edit ${acc.label}`}
                                  onClick={() => setEditing({ account: acc, domain: group.domain })}
                                >
                                  ✎
                                </button>
                                <button
                                  className="site-account-action-btn danger"
                                  title="Delete account"
                                  aria-label={`Delete ${acc.label}`}
                                  onClick={() => handleDeleteAccount(acc)}
                                >
                                  🗑
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      </>)}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {section === 'data' && (
            <div id="settings-data">
              <h2 className="settings-section-title">Data management</h2>
              <p className="settings-section-desc">
                Clear browsing data (cache, cookies, site storage) and/or
                permanently delete all of your saved vault data.
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
                <label className="clear-option clear-option-danger">
                  <input type="checkbox" checked={clearVault} onChange={e => setClearVault(e.target.checked)} />
                  <span>
                    <strong>Vault data</strong> — permanently delete ALL saved
                    accounts (and passwords), bookmarks, saved login pages,
                    per-site status &amp; categories. This cannot be undone.
                  </span>
                </label>
              </div>

              <div className="data-actions-row">
                <button
                  className="modal-btn danger"
                  onClick={handleClearData}
                  disabled={clearing || (!clearCache && !clearCookies && !clearStorage && !clearVault)}
                >
                  {clearing ? 'Clearing…' : 'Clear selected data'}
                </button>

                <div className="data-transfer-actions">
                  <button
                    className="modal-btn"
                    onClick={() => { setTransferResult(null); setTransferMode('export'); }}
                  >
                    ⬆ Data export
                  </button>
                  <button
                    className="modal-btn"
                    onClick={() => { setTransferResult(null); setTransferMode('import'); }}
                  >
                    ⬇ Data import
                  </button>
                </div>
              </div>

              <p className="settings-section-desc data-transfer-hint">
                <strong>Export</strong> saves all your accounts (including
                passwords) to a single passphrase-encrypted
                <code> .vaultbackup</code> file you can move to another device.
                <strong> Import</strong> restores such a file — it{' '}
                <strong>replaces your current data entirely</strong> (the
                existing vault is wiped and overwritten).
              </p>

              {clearResult && (
                <div className="clear-result" role="status">{clearResult}</div>
              )}
              {transferResult && (
                <div className="clear-result" role="status">{transferResult}</div>
              )}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <AccountEditModal
          account={editing.account}
          domain={editing.domain}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await loadAccounts(); }}
        />
      )}

      {editingMapping && (
        <MappingEditModal
          mapping={editingMapping}
          onClose={() => setEditingMapping(null)}
          onSaved={async () => { setEditingMapping(null); await loadAccounts(); }}
        />
      )}

      {transferMode && (
        <DataTransferModal
          mode={transferMode}
          onClose={() => setTransferMode(null)}
          onDone={async (msg) => {
            setTransferMode(null);
            setTransferResult(msg);
            if (msg) await loadAccounts();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Account edit modal
// ============================================================================
// Edits an account's label / username / password, and (for site-scoped
// accounts) its per-site status and 24h time-remaining data.

interface AccountEditModalProps {
  account: SiteAccountInfo;
  domain: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function AccountEditModal({ account, domain, onClose, onSaved }: AccountEditModalProps) {
  const api = getApi();

  const [label, setLabel] = useState(account.label);
  const [username, setUsername] = useState(account.usernameOrEmail);
  const [password, setPassword] = useState(''); // blank = keep existing
  const [showPassword, setShowPassword] = useState(false); // Bug 4: show/hide
  const [status, setStatus] = useState<LoginStatus>(account.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActiveTab = account.isActiveTab || account.status === 'active_tab_open';
  const hasTimer = !!account.loggedInUntil;
  const statusChanged = status !== account.status;

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);

    // 1. Update credential fields (label / username / password).
    const credRes = await api.credentials.update({
      id: account.loginEntryId,
      label: label.trim(),
      usernameOrEmail: username.trim(),
      ...(password ? { password } : {}),
    });
    if (!credRes.success) {
      setSaving(false);
      setError(credRes.error || 'Failed to update account.');
      return;
    }

    // 2. Update status if it changed (site-scoped accounts only).
    if (statusChanged && domain) {
      const stRes = await api.settings.setAccountStatus({
        loginEntryId: account.loginEntryId,
        domain,
        status,
      });
      if (!stRes.success) {
        setSaving(false);
        setError(stRes.error || 'Failed to change status.');
        return;
      }
    }

    setSaving(false);
    await onSaved();
  }, [api, account.loginEntryId, label, username, password, status, statusChanged, domain, onSaved]);

  const clearTimer = useCallback(async () => {
    const ok = window.confirm(
      'Delete the time-remaining data for this account?\n\n' +
      'This removes the 24h countdown; the account keeps its current status.'
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    const res = await api.settings.clearAccountTimer({ loginEntryId: account.loginEntryId, domain });
    setSaving(false);
    if (!res.success) {
      setError(res.error || 'Failed to clear timer.');
      return;
    }
    await onSaved();
  }, [api, account.loginEntryId, domain, onSaved]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal account-edit-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Edit account">
        <h3 className="modal-title">Edit account</h3>

        <label className="modal-field">
          <span className="modal-field-label">Label</span>
          <input className="modal-input" value={label} onChange={e => setLabel(e.target.value)} />
        </label>

        <label className="modal-field">
          <span className="modal-field-label">Username / email</span>
          <input className="modal-input" value={username} onChange={e => setUsername(e.target.value)} />
        </label>

        <label className="modal-field">
          <span className="modal-field-label">Password</span>
          <div className="password-input-wrap">
            <input
              className="modal-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Leave blank to keep the current password"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="password-toggle-btn"
              onClick={(e) => { e.preventDefault(); setShowPassword(v => !v); }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </label>

        <label className="modal-field">
          <span className="modal-field-label">Status</span>
          <select
            className="modal-input"
            value={isActiveTab ? 'active_tab_open' : status}
            disabled={isActiveTab || !domain}
            onChange={e => setStatus(e.target.value as LoginStatus)}
          >
            {isActiveTab && <option value="active_tab_open">{STATUS_LABEL.active_tab_open}</option>}
            {ASSIGNABLE_STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>

        {/* Warnings */}
        {isActiveTab && (
          <div className="modal-warning">
            This is the <strong>active tab</strong>. Its status can't be changed — switch to
            another account first.
          </div>
        )}
        {!domain && (
          <div className="modal-warning">
            This is an unscoped/legacy account, so it has no per-site status or timer.
          </div>
        )}
        {statusChanged && !isActiveTab && domain && (
          <div className="modal-warning">
            Changing the status will <strong>delete the time-remaining data</strong>.
          </div>
        )}

        {/* Time-remaining management */}
        {domain && hasTimer && !isActiveTab && (
          <div className="modal-timer-row">
            <span>Time-remaining data exists for this account.</span>
            <button className="modal-btn subtle" onClick={clearTimer} disabled={saving}>
              Delete time-remaining data
            </button>
          </div>
        )}

        {error && <div className="modal-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="modal-btn primary" onClick={save} disabled={saving || !label.trim() || !username.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Data transfer modal (encrypted export / import)
// ============================================================================
// Collects a passphrase, then triggers the native save/open dialog in the main
// process. Export writes an encrypted `.vaultbackup` file; import decrypts a
// chosen file and OVERWRITES the current vault.

interface DataTransferModalProps {
  mode: 'export' | 'import';
  onClose: () => void;
  onDone: (resultMessage: string | null) => void;
}

function DataTransferModal({ mode, onClose, onDone }: DataTransferModalProps) {
  const api = getApi();
  const isExport = mode === 'export';

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    if (!passphrase || passphrase.length < 4) {
      setError('Enter a passphrase of at least 4 characters.');
      return;
    }
    if (isExport && passphrase !== confirm) {
      setError('The two passphrases do not match.');
      return;
    }

    setBusy(true);
    if (isExport) {
      const res = await api.settings.exportData({ passphrase });
      setBusy(false);
      if (!res.success) { setError(res.error || 'Export failed.'); return; }
      if (res.data?.canceled) { onClose(); return; }
      onDone(
        `Exported ${res.data?.accounts ?? 0} account(s) to an encrypted backup file.`
      );
    } else {
      const res = await api.settings.importData({ passphrase });
      setBusy(false);
      if (!res.success) { setError(res.error || 'Import failed.'); return; }
      if (res.data?.canceled) { onClose(); return; }
      onDone(
        `Imported ${res.data?.accounts ?? 0} account(s). Your previous data was replaced.`
      );
    }
  }, [api, isExport, passphrase, confirm, onClose, onDone]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal account-edit-modal" onMouseDown={e => e.stopPropagation()}>
        <h3 className="modal-title">{isExport ? 'Export encrypted backup' : 'Import backup'}</h3>

        {isExport ? (
          <p className="settings-section-desc">
            Choose a passphrase to encrypt the backup. You will need this exact
            passphrase to import the file on another device — it cannot be
            recovered if lost.
          </p>
        ) : (
          <div className="modal-warning">
            Importing <strong>replaces your current data entirely</strong>. All
            accounts, categories, bookmarks and login timers in this vault will
            be deleted and overwritten by the backup.
          </div>
        )}

        <div className="modal-field">
          <label className="modal-field-label">Passphrase</label>
          <input
            className="modal-input"
            type="password"
            value={passphrase}
            autoFocus
            onChange={e => setPassphrase(e.target.value)}
            placeholder={isExport ? 'Create a passphrase' : 'Enter the backup passphrase'}
          />
        </div>

        {isExport && (
          <div className="modal-field">
            <label className="modal-field-label">Confirm passphrase</label>
            <input
              className="modal-input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter the passphrase"
            />
          </div>
        )}

        {error && <div className="modal-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={isExport ? 'modal-btn primary' : 'modal-btn danger'}
            onClick={run}
            disabled={busy || !passphrase}
          >
            {busy
              ? (isExport ? 'Exporting…' : 'Importing…')
              : (isExport ? 'Choose file & export' : 'Choose file & overwrite')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Login-page mapping URLs (visual mapping inside a site card)
// ============================================================================
// Shows the Main URL and the Related URLs associated with a login page. When
// related URLs overflow, only the first few are shown followed by "+ [n] more"
// (toggles to reveal the rest).

const RELATED_PREVIEW_COUNT = 3;

function MappingUrls({ mapping }: { mapping: LoginPageMapping }) {
  const [expanded, setExpanded] = useState(false);
  const related = mapping.relatedUrls || [];
  const shown = expanded ? related : related.slice(0, RELATED_PREVIEW_COUNT);
  const hiddenCount = related.length - shown.length;

  return (
    <div className="mapping-urls">
      <div className="mapping-url-row">
        <span className="mapping-url-tag main">Main</span>
        <span className="mapping-url-value truncate" title={mapping.mainDomain}>{mapping.mainDomain}</span>
      </div>
      {related.length > 0 && (
        <div className="mapping-url-row related">
          <span className="mapping-url-tag related">Related</span>
          <span className="mapping-url-chips">
            {shown.map((r, i) => (
              <span key={i} className="mapping-url-chip" title={r}>{r}</span>
            ))}
            {hiddenCount > 0 && (
              <button className="mapping-url-more" onClick={() => setExpanded(true)}>
                + {hiddenCount} more
              </button>
            )}
            {expanded && related.length > RELATED_PREVIEW_COUNT && (
              <button className="mapping-url-more" onClick={() => setExpanded(false)}>
                show less
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Login-page mapping edit modal (in-place editor from Settings)
// ============================================================================
// Lets the user change the Main URL, add/remove Related URLs, and toggle the
// category restriction ("Set as Login Page" behavior) for a saved login page.

interface MappingEditModalProps {
  mapping: LoginPageMapping;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function MappingEditModal({ mapping, onClose, onSaved }: MappingEditModalProps) {
  const api = getApi();

  const [mainDomain, setMainDomain] = useState(mapping.mainDomain);
  const [loginUrl, setLoginUrl] = useState(mapping.loginUrl);
  const [related, setRelated] = useState<string[]>(mapping.relatedUrls || []);
  const [newRelated, setNewRelated] = useState('');
  const [restricted, setRestricted] = useState(mapping.categoryRestricted);
  const [categoryId, setCategoryId] = useState<string | null>(mapping.categoryId);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await api.categories.list();
      if (res.success && res.data) setCategories(res.data);
    })();
  }, [api]);

  const addRelated = useCallback(() => {
    const v = newRelated.trim();
    if (!v) return;
    setRelated(prev => (prev.includes(v) ? prev : [...prev, v]));
    setNewRelated('');
  }, [newRelated]);

  const removeRelated = useCallback((r: string) => {
    setRelated(prev => prev.filter(x => x !== r));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const res = await api.loginPages.update({
      id: mapping.id,
      mainDomain: mainDomain.trim(),
      loginUrl: loginUrl.trim(),
      relatedUrls: related,
      categoryRestricted: restricted,
      categoryId: restricted ? categoryId : null,
    });
    setSaving(false);
    if (res.success) {
      await onSaved();
    } else {
      setError(res.error || 'Failed to update the login-page mapping.');
    }
  }, [api, mapping.id, mainDomain, loginUrl, related, restricted, categoryId, onSaved]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal login-page-modal mapping-edit-modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Edit login-page mapping</h3>
        <p className="settings-section-desc">
          Login page: <code>{mapping.loginDomain || mapping.loginUrl}</code>
        </p>

        <div className="modal-field">
          <label className="modal-field-label">Main website</label>
          <input
            className="modal-input"
            value={mainDomain}
            onChange={e => setMainDomain(e.target.value)}
            placeholder="example.com"
          />
          <div className="modal-hint">The primary site this login page signs you into.</div>
        </div>

        <div className="modal-field">
          <label className="modal-field-label">Login page URL</label>
          <input
            className="modal-input"
            value={loginUrl}
            onChange={e => setLoginUrl(e.target.value)}
            placeholder="https://login.example.com/"
          />
        </div>

        <div className="modal-field">
          <label className="modal-field-label">Related URLs</label>
          <div className="related-editor">
            {related.length === 0 && (
              <div className="modal-hint">No related URLs yet. Add any path under the main site (e.g. <code>example.com/app</code>).</div>
            )}
            {related.map((r, i) => (
              <div key={i} className="related-editor-row">
                <span className="related-editor-url truncate" title={r}>{r}</span>
                <button className="related-editor-remove" title="Remove" onClick={() => removeRelated(r)}>✕</button>
              </div>
            ))}
            <div className="related-editor-add">
              <input
                className="modal-input"
                value={newRelated}
                onChange={e => setNewRelated(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRelated(); } }}
                placeholder="example.com/dashboard"
              />
              <button className="modal-btn" onClick={addRelated} disabled={!newRelated.trim()}>Add</button>
            </div>
          </div>
        </div>

        <div className="modal-checkbox-row">
          <input
            id="mapping-edit-restrict"
            type="checkbox"
            checked={restricted}
            onChange={e => setRestricted(e.target.checked)}
          />
          <label htmlFor="mapping-edit-restrict">
            Restrict to a category (only accounts in that category use this login page)
          </label>
        </div>

        {restricted && (
          <div className="modal-field">
            <label className="modal-field-label">Category</label>
            <select
              className="modal-input"
              value={categoryId ?? ''}
              onChange={e => setCategoryId(e.target.value || null)}
            >
              <option value="">— choose a category —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="modal-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="modal-btn primary" onClick={save} disabled={saving || !mainDomain.trim() || !loginUrl.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
