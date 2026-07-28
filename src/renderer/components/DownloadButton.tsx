// ============================================================================
// Download toolbar button (compact top-bar entry point)
// ============================================================================
// Behaviour (browser-like):
//   • Hidden entirely when no downloads exist yet.
//   • Appears once at least one download exists and stays visible afterwards.
//   • While any download is active it shows an animated progress ring around
//     the arrow reflecting the aggregate progress.
//   • When finished, it changes colour to indicate completed/unseen downloads,
//     and shows a small badge dot for new (unseen) downloads.

import React, { forwardRef } from 'react';
import { DownloadItem } from '../../shared/types';
import { isActive, progressOf } from './download-utils';

interface DownloadButtonProps {
  downloads: DownloadItem[];
  /** Number of downloads the user hasn't seen since the panel was last opened. */
  unseenCount: number;
  onClick: () => void;
  /** True while the panel anchored to this button is open. */
  open?: boolean;
}

const DownloadButton = forwardRef<HTMLButtonElement, DownloadButtonProps>(
  ({ downloads, unseenCount, onClick, open = false }, ref) => {
    // Hidden until at least one download exists.
    if (downloads.length === 0) return null;

    const active = downloads.filter(isActive);
    const isDownloading = active.length > 0;

    // Aggregate progress across active downloads (0..1). When nothing is
    // active the ring is full.
    let aggregate = 1;
    if (isDownloading) {
      const sum = active.reduce((acc, d) => acc + progressOf(d), 0);
      aggregate = sum / active.length;
    }

    // Colour state:
    //   downloading -> accent (in-progress)
    //   unseen finished -> "attention" colour
    //   otherwise -> idle
    const stateClass = isDownloading
      ? 'downloading'
      : unseenCount > 0
        ? 'unseen'
        : 'idle';

    // Conic-gradient ring for progress (percentage of a full circle).
    const pct = Math.round(aggregate * 100);
    const ringStyle: React.CSSProperties = isDownloading
      ? { ['--dl-progress' as any]: `${pct}%` }
      : {};

    const title = isDownloading
      ? `Downloading ${active.length} file${active.length === 1 ? '' : 's'} — ${pct}%`
      : unseenCount > 0
        ? `${unseenCount} new download${unseenCount === 1 ? '' : 's'}`
        : 'Downloads';

    return (
      <button
        ref={ref}
        type="button"
        className={`download-btn ${stateClass}${open ? ' open' : ''}${isDownloading ? ' has-ring' : ''}`}
        style={ringStyle}
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="download-btn-ring" aria-hidden="true" />
        <span className="download-btn-glyph" aria-hidden="true">⬇</span>
        {unseenCount > 0 && !isDownloading && (
          <span className="download-btn-badge" aria-hidden="true">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>
    );
  }
);

DownloadButton.displayName = 'DownloadButton';

export default DownloadButton;
