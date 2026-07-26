// ============================================================================
// Save Bookmark Modal
// ============================================================================
// Opened when the user clicks the Star button. Lets the user:
//   - set a custom bookmark name
//   - choose an existing folder
//   - create a new folder
//   - confirm where the bookmark will be saved

import React, { useState } from 'react';

export interface BookmarkDraft {
  title: string;
  url: string;
  folder: string;
}

interface SaveBookmarkModalProps {
  /** The URL being bookmarked (fixed, shown read-only). */
  url: string;
  /** Suggested default title (usually the page title). */
  defaultTitle: string;
  /** Existing folder names to choose from. */
  folders: string[];
  onCancel: () => void;
  onSave: (draft: BookmarkDraft) => void;
}

// Sentinel value used in the folder <select> to mean "create a new folder".
const NEW_FOLDER = '__new__';
const TOP_LEVEL = '';

export default function SaveBookmarkModal({
  url,
  defaultTitle,
  folders,
  onCancel,
  onSave,
}: SaveBookmarkModalProps) {
  const [title, setTitle] = useState(defaultTitle || url);
  const [folderChoice, setFolderChoice] = useState<string>(TOP_LEVEL);
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState<string | null>(null);

  const creatingNew = folderChoice === NEW_FOLDER;

  const resolvedFolder = (): string => {
    if (creatingNew) return newFolder.trim();
    return folderChoice; // '' = top level, or an existing folder name
  };

  const handleSave = () => {
    if (!title.trim()) {
      setError('Please enter a bookmark name.');
      return;
    }
    if (creatingNew && !newFolder.trim()) {
      setError('Please enter a name for the new folder.');
      return;
    }
    onSave({ title: title.trim(), url, folder: resolvedFolder() });
  };

  // Where the bookmark will end up — shown as a confirmation hint.
  const placementLabel = () => {
    const folder = resolvedFolder();
    return folder === '' ? 'Bookmarks bar (top level)' : `Folder: ${folder}`;
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Save bookmark</div>

        {error && <div className="modal-error" role="alert">{error}</div>}

        {/* Name */}
        <div className="modal-field">
          <label className="modal-label">Name</label>
          <input
            className="modal-input"
            placeholder="Bookmark name"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        {/* URL (read-only) */}
        <div className="modal-field">
          <label className="modal-label">URL</label>
          <input className="modal-input" value={url} readOnly disabled />
        </div>

        {/* Folder */}
        <div className="modal-field">
          <label className="modal-label">Folder</label>
          <select
            className="modal-input"
            value={folderChoice}
            onChange={e => setFolderChoice(e.target.value)}
          >
            <option value={TOP_LEVEL}>Bookmarks bar (no folder)</option>
            {folders.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
            <option value={NEW_FOLDER}>+ Create new folder…</option>
          </select>
        </div>

        {/* New folder name */}
        {creatingNew && (
          <div className="modal-field">
            <label className="modal-label">New folder name</label>
            <input
              className="modal-input"
              placeholder="e.g. Work"
              value={newFolder}
              onChange={e => setNewFolder(e.target.value)}
            />
          </div>
        )}

        {/* Placement confirmation */}
        <div className="bookmark-placement-hint">
          Will be saved to: <strong>{placementLabel()}</strong>
        </div>

        <div className="modal-actions">
          <button className="modal-btn" onClick={onCancel}>Cancel</button>
          <button className="modal-btn primary" onClick={handleSave} disabled={!title.trim()}>
            Save bookmark
          </button>
        </div>
      </div>
    </div>
  );
}
