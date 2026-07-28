// ============================================================================
// Floating downloads panel (anchored to the toolbar button)
// ============================================================================
// Browser-like dropdown showing current + recent downloads. Rendered above all
// other UI with a very high z-index; while it is open the caller detaches the
// native BrowserView (setOverlay) so the panel is visible/clickable over the
// web page. Separate rows for active vs completed. Per-item actions, clear
// separation between "remove from history" and "delete file from disk",
// keyboard navigation, close-on-escape.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { DownloadItem } from '../../shared/types';
import { formatBytes, progressOf, isActive, statusLabel, formatWhen } from './download-utils';

interface DownloadsPanelProps {
  downloads: DownloadItem[];
  onClose: () => void;
  onOpenHistory: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFile: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onClearFinished: () => void;
}

export default function DownloadsPanel({
  downloads,
  onClose,
  onOpenHistory,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onOpenFile,
  onShowInFolder,
  onRemove,
  onDeleteFile,
  onClearFinished,
}: DownloadsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The most-recent downloads (already sorted DESC by the caller). Cap the
  // dropdown to a manageable number; the full list lives on the history page.
  const recent = downloads.slice(0, 12);
  const active = recent.filter(isActive);
  const finished = recent.filter(d => !isActive(d));

  // Keyboard navigation: a flat ordered list of focusable rows.
  const orderedIds = [...active, ...finished].map(d => d.id);
  const [focusIndex, setFocusIndex] = useState(0);

  // Close on Escape + click-outside; trap simple arrow navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (orderedIds.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex(i => Math.min(orderedIds.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex(i => Math.max(0, i - 1));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, orderedIds.length]);

  // Focus the panel on mount so keyboard nav works immediately.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Move DOM focus to the focused row.
  useEffect(() => {
    const id = orderedIds[focusIndex];
    if (!id) return;
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-dl-row="${id}"]`);
    el?.focus();
  }, [focusIndex, orderedIds]);

  const handleBackdropClick = useCallback(() => onClose(), [onClose]);

  const renderRow = (item: DownloadItem, rowIndex: number) => {
    const pct = Math.round(progressOf(item) * 100);
    const completed = item.state === 'completed';
    const failed = item.state === 'interrupted' || item.state === 'cancelled';
    const running = isActive(item);

    return (
      <li
        key={item.id}
        className={`dl-row dl-row-${item.state}${focusIndex === rowIndex ? ' focused' : ''}`}
        data-dl-row={item.id}
        tabIndex={-1}
        onFocus={() => setFocusIndex(rowIndex)}
        onDoubleClick={() => completed && onOpenFile(item.id)}
      >
        <span className={`dl-row-icon dl-icon-${item.state}`} aria-hidden="true">
          {completed ? '📄' : running ? '⬇' : '⚠'}
        </span>

        <div className="dl-row-main">
          <button
            className={`dl-row-name${completed ? ' openable' : ''}`}
            title={completed ? `Open ${item.filename}` : item.filename}
            onClick={() => { if (completed) onOpenFile(item.id); }}
          >
            {item.filename}
          </button>

          {running && (
            <div className="dl-row-progress" aria-hidden="true">
              <div
                className={`dl-row-progress-fill${item.state === 'paused' ? ' paused' : ''}`}
                style={{ width: `${item.totalBytes > 0 ? pct : 100}%` }}
              />
            </div>
          )}

          <div className="dl-row-status">
            <span className="dl-row-status-text">{statusLabel(item)}</span>
            {running && item.totalBytes > 0 && (
              <span className="dl-row-pct">{pct}%</span>
            )}
            <span className="dl-row-when">{formatWhen(item.updatedAt || item.createdAt)}</span>
          </div>
        </div>

        <div className="dl-row-actions">
          {running && (
            <>
              {item.state === 'paused' ? (
                <button className="dl-action" title="Resume" aria-label="Resume" onClick={() => onResume(item.id)}>▶</button>
              ) : (
                <button className="dl-action" title="Pause" aria-label="Pause" onClick={() => onPause(item.id)}>⏸</button>
              )}
              <button className="dl-action" title="Cancel" aria-label="Cancel" onClick={() => onCancel(item.id)}>✕</button>
            </>
          )}

          {completed && (
            <>
              <button className="dl-action" title="Open file" aria-label="Open file" onClick={() => onOpenFile(item.id)}>↗</button>
              {/* 'show in folder' only for completed items */}
              <button className="dl-action" title="Show in folder" aria-label="Show in folder" onClick={() => onShowInFolder(item.id)}>📁</button>
            </>
          )}

          {failed && (
            <button className="dl-action" title="Retry" aria-label="Retry" onClick={() => onRetry(item.id)}>⟳</button>
          )}

          {!running && (
            <>
              {/* CLEAR separation: remove from history vs delete file from disk */}
              <button className="dl-action" title="Remove from list" aria-label="Remove from list" onClick={() => onRemove(item.id)}>🗑</button>
              {completed && (
                <button className="dl-action danger" title="Delete file from disk" aria-label="Delete file from disk" onClick={() => onDeleteFile(item.id)}>⌫</button>
              )}
            </>
          )}
        </div>
      </li>
    );
  };

  const hasFinished = finished.length > 0;

  return (
    <>
      {/* Transparent backdrop so a click anywhere outside closes the panel. */}
      <div className="dl-panel-backdrop" onClick={handleBackdropClick} aria-hidden="true" />

      <div
        ref={panelRef}
        className="dl-panel"
        role="dialog"
        aria-label="Downloads"
        tabIndex={-1}
      >
        <header className="dl-panel-header">
          <span className="dl-panel-title">Downloads</span>
          <button className="dl-panel-close" onClick={onClose} title="Close (Esc)" aria-label="Close downloads">✕</button>
        </header>

        {recent.length === 0 ? (
          <div className="dl-panel-empty">No downloads yet.</div>
        ) : (
          <div className="dl-panel-scroll">
            {active.length > 0 && (
              <>
                <div className="dl-group-label">Active</div>
                <ul className="dl-list">
                  {active.map((item, i) => renderRow(item, i))}
                </ul>
              </>
            )}
            {finished.length > 0 && (
              <>
                <div className="dl-group-label">Completed</div>
                <ul className="dl-list">
                  {finished.map((item, i) => renderRow(item, active.length + i))}
                </ul>
              </>
            )}
          </div>
        )}

        <footer className="dl-panel-footer">
          {hasFinished && (
            <button className="dl-panel-clear" onClick={onClearFinished} title="Clear finished downloads from the list">
              Clear finished
            </button>
          )}
          <button className="dl-panel-history" onClick={onOpenHistory}>
            Open download history
          </button>
        </footer>
      </div>
    </>
  );
}
