// ============================================================================
// Category Create / Edit Modal
// ============================================================================
// Lets the user name a category, pick accounts, choose an icon (from a basic
// set or a custom uploaded image), and select Global vs Private visibility.

import React, { useState, useRef, useMemo } from 'react';
import { Category, CategoryScope, LoginEntry } from '../../shared/types';

const BASIC_ICONS = ['📁', '⭐', '💼', '🏦', '🛒', '🎮', '📧', '🔐', '☁️', '🌐', '👤', '❤️'];

export interface CategoryDraft {
  name: string;
  icon: string;
  scope: CategoryScope;
  accountIds: string[];
  /** For private categories: the site this category is tied to. */
  domain: string;
}

interface CategoryModalProps {
  /** When editing, the existing category; null when creating. */
  editing: Category | null;
  /** Accounts available to add (already scoped to the current site). */
  accounts: LoginEntry[];
  /** Current site host — used as the default for Private categories. */
  currentDomain: string | null;
  /** Domains of sites that are currently open (have tabs) — picker options. */
  openDomains: string[];
  onCancel: () => void;
  onSave: (draft: CategoryDraft) => void;
}

export default function CategoryModal({
  editing,
  accounts,
  currentDomain,
  openDomains,
  onCancel,
  onSave,
}: CategoryModalProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? '📁');
  const [scope, setScope] = useState<CategoryScope>(editing?.scope ?? 'global');
  const [accountIds, setAccountIds] = useState<string[]>(editing?.accountIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // For private categories: the chosen site. Defaults to the existing category's
  // domain (edit), else the current site. The options are the open sites plus
  // any already-selected domain (so an edit keeps its value even if that tab is
  // closed).
  const siteOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of openDomains) if (d) set.add(d);
    if (currentDomain) set.add(currentDomain);
    if (editing?.domain) set.add(editing.domain);
    return Array.from(set).sort();
  }, [openDomains, currentDomain, editing]);

  const [privateDomain, setPrivateDomain] = useState<string>(
    editing?.domain || currentDomain || (siteOptions[0] ?? '')
  );

  const isCustomIcon = icon.startsWith('data:');

  const toggleAccount = (id: string) => {
    setAccountIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleUploadIcon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) {
      setError('Custom icon must be under 256 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setIcon(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!name.trim()) { setError('Please enter a category name.'); return; }
    if (scope === 'private') {
      const chosen = (privateDomain || '').trim().toLowerCase();
      if (!chosen) {
        setError('Choose a site for this private category (open a website first).');
        return;
      }
      onSave({ name: name.trim(), icon, scope, accountIds, domain: chosen });
      return;
    }
    onSave({ name: name.trim(), icon, scope, accountIds, domain: '' });
  };

  const hasSiteOptions = siteOptions.length > 0;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal category-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{editing ? 'Edit Category' : 'New Category'}</div>

        {error && <div className="modal-error" role="alert">{error}</div>}

        {/* Name */}
        <div className="modal-field">
          <label className="modal-label">Category name</label>
          <input
            className="modal-input"
            placeholder="e.g. Work accounts"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Visibility */}
        <div className="modal-field">
          <label className="modal-label">Visibility</label>
          <div className="scope-options">
            <label className={`scope-option${scope === 'global' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="scope"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              <span><strong>Global</strong> — usable on all websites</span>
            </label>
            <label className={`scope-option${scope === 'private' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="scope"
                checked={scope === 'private'}
                onChange={() => setScope('private')}
                disabled={!hasSiteOptions}
              />
              <span>
                <strong>Private</strong> — only on a chosen site
              </span>
            </label>
          </div>
        </div>

        {/* Private-category site picker (#3): pick from open sites/tabs. */}
        {scope === 'private' && (
          <div className="modal-field">
            <label className="modal-label">Site for this category</label>
            {hasSiteOptions ? (
              <select
                className="modal-input"
                value={privateDomain}
                onChange={e => setPrivateDomain(e.target.value)}
              >
                {siteOptions.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <div className="account-checklist-empty">
                No open sites. Open a website (a tab) first, then create a private category.
              </div>
            )}
            <div className="sidebar-empty-hint">
              This category will only appear in the vault sidebar when you are on{' '}
              {privateDomain ? <code>{privateDomain}</code> : 'the selected site'}.
            </div>
          </div>
        )}

        {/* Icon */}
        <div className="modal-field">
          <label className="modal-label">Icon</label>
          <div className="icon-picker">
            {BASIC_ICONS.map(ic => (
              <button
                key={ic}
                type="button"
                className={`icon-choice${icon === ic ? ' selected' : ''}`}
                onClick={() => setIcon(ic)}
              >
                {ic}
              </button>
            ))}
            <button
              type="button"
              className={`icon-choice upload${isCustomIcon ? ' selected' : ''}`}
              onClick={() => fileRef.current?.click()}
              title="Upload custom icon"
            >
              {isCustomIcon ? <img src={icon} alt="custom" className="icon-custom-preview" /> : '＋'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleUploadIcon}
            />
          </div>
        </div>

        {/* Accounts */}
        <div className="modal-field">
          <label className="modal-label">Accounts in this category</label>
          <div className="account-checklist">
            {accounts.length === 0 ? (
              <div className="account-checklist-empty">No accounts available for this site yet.</div>
            ) : (
              accounts.map(acc => (
                <label key={acc.id} className="account-check">
                  <input
                    type="checkbox"
                    checked={accountIds.includes(acc.id)}
                    onChange={() => toggleAccount(acc.id)}
                  />
                  <span className="account-check-label">{acc.label}</span>
                  <span className="account-check-user">{acc.usernameOrEmail}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="modal-btn" onClick={onCancel}>Cancel</button>
          <button className="modal-btn primary" onClick={handleSave} disabled={!name.trim()}>
            {editing ? 'Save changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
