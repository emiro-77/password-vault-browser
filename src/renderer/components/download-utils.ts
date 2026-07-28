// ============================================================================
// Download UI helpers — shared formatting & state derivation
// ============================================================================

import { DownloadItem, DownloadState } from '../../shared/types';

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Progress fraction 0..1 for an item (0 when total is unknown). */
export function progressOf(item: DownloadItem): number {
  if (item.state === 'completed') return 1;
  if (!item.totalBytes || item.totalBytes <= 0) return 0;
  return Math.min(1, item.receivedBytes / item.totalBytes);
}

/** A download that is still moving (downloading or paused). */
export function isActive(item: DownloadItem): boolean {
  return item.state === 'in_progress' || item.state === 'paused';
}

/** Short human status label for a download row. */
export function statusLabel(item: DownloadItem): string {
  switch (item.state) {
    case 'in_progress':
      if (item.totalBytes > 0) {
        return `${formatBytes(item.receivedBytes)} of ${formatBytes(item.totalBytes)}`;
      }
      return `${formatBytes(item.receivedBytes)} downloaded`;
    case 'paused':
      return 'Paused';
    case 'completed':
      return formatBytes(item.totalBytes || item.receivedBytes);
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed';
    default:
      return item.state;
  }
}

const STATE_ICON: Record<DownloadState, string> = {
  in_progress: '⬇',
  paused: '⏸',
  completed: '✓',
  cancelled: '⊘',
  interrupted: '⚠',
};

export function stateIcon(state: DownloadState): string {
  return STATE_ICON[state] ?? '⬇';
}

/** Relative-ish timestamp, e.g. "3 min ago", falling back to a date string. */
export function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

/** Full timestamp for the history page. */
export function formatFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
