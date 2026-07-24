// ============================================================================
// Save Login Page Modal
// ============================================================================
// Opened from the 🔑 toolbar button (right of the bookmark star). Lets the user
// save the CURRENT page as the login page for a chosen MAIN website.
//
// Fields:
//   - Main Website : pick from previously-opened sites (or the current one).
//     Connects this login page to that main site (login.chatgpt.com -> chatgpt.com).
//   - Category     : choose an existing category or create a new one.
//   - Category restriction toggle : when OFF, ANY account may use this mapping
//     while on the main website / related pages. When ON, only accounts in the
//     chosen category use it.
//
// After saving, selecting a qualifying account on the main site (or any nested
// page under it) opens this login page and autofills it.

import React, { useMemo, useState, useCallback } from 'react';
import { Category } from '../../shared/types';
import { getApi } from '../api';
import { domainFromUrl } from '../../shared/url-utils';

interface SaveLoginPageModalProps {
  currentUrl: string;
  currentDomain: string | null;
  /** Domains of previously-opened tabs, used to populate the main-website list. */
  openedDomains: string[];
  categories: Category[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

export default function SaveLoginPageModal({
  currentUrl,
  currentDomain,
  openedDomains,
  categories,
  onClose,
  onSaved,
}: SaveLoginPageModalProps) {
  const api = getApi();

  // Candidate main websites: every distinct opened domain plus the current one.
  const mainSiteOptions = useMemo(() => {
    const set = new Set<string>();
    if (currentDomain) set.add(currentDomain);
    for (const d of openedDomains) if (d) set.add(d);
    return Array.from(set).sort();
  }, [openedDomains, currentDomain]);

  const [mainDomain, setMainDomain] = useState<string>(
    currentDomain || mainSiteOptions[0] || ''
  );

  // Category selection. '' = no category; '__new__' = create a new one.
  const [categoryId, setCategoryId] = useState<string>('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [restricted, setRestricted] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginHost = domainFromUrl(currentUrl) || currentUrl;

  const save = useCallback(async () => {
    setError(null);

    if (!mainDomain.trim()) {
      setError('Choose the main website this login page belongs to.');
      return;
    }
    if (!currentUrl || currentUrl === 'about:blank') {
      setError('There is no page loaded to save as a login page.');
      return;
    }

    setSaving(true);

    // Resolve the category to use. If restriction is on, we need one; if the
    // user chose "new", create it first (as a global category, tied to nothing
    // so any site can reference it).
    let effectiveCategoryId: string | null = null;
    if (restricted) {
      if (categoryId === '__new__') {
        const name = newCategoryName.trim();
        if (!name) {
          setSaving(false);
          setError('Enter a name for the new category.');
          return;
        }
        const created = await api.categories.create({ name, scope: 'global' });
        if (!created.success || !created.data) {
          setSaving(false);
          setError(created.error || 'Could not create the category.');
          return;
        }
        effectiveCategoryId = created.data.id;
      } else if (categoryId) {
        effectiveCategoryId = categoryId;
      } else {
        setSaving(false);
        setError('Pick a category, or turn off the category restriction.');
        return;
      }
    }

    const res = await api.loginPages.save({
      mainDomain: mainDomain.trim(),
      loginUrl: currentUrl,
      categoryId: effectiveCategoryId,
      categoryRestricted: restricted,
    });

    setSaving(false);
    if (!res.success) {
      setError(res.error || 'Could not save the login page.');
      return;
    }

    onSaved(
      `Saved this page as the login page for ${mainDomain.trim()}${
        restricted ? ' (restricted to the chosen category)' : ''
      }.`
    );
  }, [api, mainDomain, currentUrl, restricted, categoryId, newCategoryName, onSaved]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal login-page-modal" onMouseDown={e => e.stopPropagation()}>
        <h3 className="modal-title">Set as login page</h3>
        <p className="settings-section-desc">
          Save this page (<code>{loginHost}</code>) as the login page for a main
          website. When you select an account on that site or a related page,
          the browser opens this page and fills in the account automatically.
        </p>

        {/* Main website */}
        <div className="modal-field">
          <label className="modal-field-label">Main website</label>
          {mainSiteOptions.length > 0 ? (
            <select
              className="modal-input"
              value={mainDomain}
              onChange={e => setMainDomain(e.target.value)}
            >
              {mainSiteOptions.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <input
              className="modal-input"
              type="text"
              value={mainDomain}
              onChange={e => setMainDomain(e.target.value)}
              placeholder="e.g. chatgpt.com"
            />
          )}
          <p className="modal-hint">
            Pick a previously-opened website. Example: this page is{' '}
            <code>{loginHost}</code>, main website could be{' '}
            <code>{currentDomain || 'chatgpt.com'}</code>.
          </p>
        </div>

        {/* Category restriction toggle */}
        <div className="modal-field">
          <label className="modal-checkbox-row">
            <input
              type="checkbox"
              checked={restricted}
              onChange={e => setRestricted(e.target.checked)}
            />
            <span>
              <strong>Restrict to a category</strong> — only accounts in the
              chosen category use this login page. Leave off to let{' '}
              <strong>any account</strong> on the main site use it.
            </span>
          </label>
        </div>

        {/* Category picker (only when restricted) */}
        {restricted && (
          <div className="modal-field">
            <label className="modal-field-label">Category</label>
            <select
              className="modal-input"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
            >
              <option value="">— Select a category —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__new__">+ Create new category…</option>
            </select>

            {categoryId === '__new__' && (
              <input
                className="modal-input"
                type="text"
                style={{ marginTop: 8 }}
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                placeholder="New category name"
              />
            )}
          </div>
        )}

        {error && <div className="modal-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="modal-btn primary"
            onClick={save}
            disabled={saving || !mainDomain.trim()}
          >
            {saving ? 'Saving…' : 'Save login page'}
          </button>
        </div>
      </div>
    </div>
  );
}
