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
import { SiteAccountsGroup, SiteAccountInfo, LoginStatus } from '../../shared/types';
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

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    const res = await api.settings.siteAccounts();
    if (res.success && res.data) setGroups(res.data);
    setAccountsLoading(false);
  }, [api]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

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

              <div className="data-actions-row">
                <button
                  className="modal-btn danger"
                  onClick={handleClearData}
                  disabled={clearing || (!clearCache && !clearCookies && !clearStorage)}
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
          <input
            className="modal-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Leave blank to keep the current password"
            autoComplete="new-password"
          />
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
