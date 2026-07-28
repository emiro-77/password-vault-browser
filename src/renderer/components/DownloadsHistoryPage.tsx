// ============================================================================
// Full download history page (full-screen view above the browser)
// ============================================================================
// Lists ALL previous downloads with search, status filtering, file path,
// timestamps, and actions to open the file or reveal it in the folder. Also
// exposes remove-from-history vs delete-file-from-disk, clearly separated.

import React, { useMemo, useState } from 'react';
import { DownloadItem, DownloadState } from '../../shared/types';
import { formatBytes, statusLabel, formatFull, isActive } from './download-utils';

interface DownloadsHistoryPageProps {
  downloads: DownloadItem[];
  onClose: () => void;
  onOpenFile: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onRetry: (id: string) => void;
  onClearFinished: () => void;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

const STATUS_TAG: Record<DownloadState, string> = {
  in_progress: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  interrupted: 'Failed',
};

export default function DownloadsHistoryPage({
  downloads,
  onClose,
  onOpenFile,
  onShowInFolder,
  onRemove,
  onDeleteFile,
  onRetry,
  onClearFinished,
}: DownloadsHistoryPageProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return downloads.filter(d => {
      if (filter === 'active' && !isActive(d)) return false;
      if (filter === 'completed' && d.state !== 'completed') return false;
      if (filter === 'failed' && d.state !== 'interrupted' && d.state !== 'cancelled') return false;
      if (q) {
        const hay = `${d.filename} ${d.savePath} ${d.url}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [downloads, search, filter]);

  const counts = useMemo(() => ({
    all: downloads.length,
    active: downloads.filter(isActive).length,
    completed: downloads.filter(d => d.state === 'completed').length,
    failed: downloads.filter(d => d.state === 'interrupted' || d.state === 'cancelled').length,
  }), [downloads]);

  return (
    <div className="dl-history" role="dialog" aria-label="Download history">
      <header className="dl-history-header">
        <h1 className="dl-history-title">Download history</h1>
        <button className="dl-history-close" onClick={onClose} title="Close (Esc)" aria-label="Close download history">✕</button>
      </header>

      <div className="dl-history-toolbar">
        <div className="dl-history-search">
          <span className="dl-history-search-icon" aria-hidden="true">🔍</span>
          <input
            className="dl-history-search-input"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, path or URL…"
            spellCheck={false}
          />
        </div>

        <div className="dl-history-filters" role="tablist" aria-label="Filter downloads">
          {(['all', 'active', 'completed', 'failed'] as StatusFilter[]).map(f => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`dl-history-filter${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'completed' ? 'Completed' : 'Failed'}
              <span className="dl-history-filter-count">{counts[f]}</span>
            </button>
          ))}
        </div>

        <button className="modal-btn" onClick={onClearFinished} disabled={counts.completed + counts.failed === 0}>
          Clear finished
        </button>
      </div>

      <div className="dl-history-body">
        {filtered.length === 0 ? (
          <div className="dl-history-empty">
            {downloads.length === 0 ? 'No downloads yet.' : 'No downloads match your search.'}
          </div>
        ) : (
          <table className="dl-history-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Size</th>
                <th>Location</th>
                <th>When</th>
                <th className="dl-history-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const completed = d.state === 'completed';
                const failed = d.state === 'interrupted' || d.state === 'cancelled';
                return (
                  <tr key={d.id} className={`dl-history-row dl-history-row-${d.state}`}>
                    <td className="dl-history-name">
                      <button
                        className={`dl-history-name-btn${completed ? ' openable' : ''}`}
                        title={completed ? `Open ${d.filename}` : d.filename}
                        onClick={() => { if (completed) onOpenFile(d.id); }}
                      >
                        {d.filename}
                      </button>
                    </td>
                    <td>
                      <span className={`dl-status-tag dl-status-${d.state}`}>{STATUS_TAG[d.state]}</span>
                    </td>
                    <td className="dl-history-size">{formatBytes(d.totalBytes || d.receivedBytes)}</td>
                    <td className="dl-history-path" title={d.savePath}>{d.savePath || '—'}</td>
                    <td className="dl-history-when" title={formatFull(d.createdAt)}>{formatFull(d.createdAt)}</td>
                    <td className="dl-history-actions">
                      {completed && (
                        <>
                          <button className="dl-action" title="Open file" aria-label="Open file" onClick={() => onOpenFile(d.id)}>↗</button>
                          <button className="dl-action" title="Show in folder" aria-label="Show in folder" onClick={() => onShowInFolder(d.id)}>📁</button>
                        </>
                      )}
                      {failed && (
                        <button className="dl-action" title="Retry" aria-label="Retry" onClick={() => onRetry(d.id)}>⟳</button>
                      )}
                      <button className="dl-action" title="Remove from history" aria-label="Remove from history" onClick={() => onRemove(d.id)}>🗑</button>
                      {completed && (
                        <button className="dl-action danger" title="Delete file from disk" aria-label="Delete file from disk" onClick={() => onDeleteFile(d.id)}>⌫</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
