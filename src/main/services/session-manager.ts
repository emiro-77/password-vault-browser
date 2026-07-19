// ============================================================================
// Session Manager — coordinates session lifecycle, partition cleanup
// ============================================================================
//
// Works alongside TabManager to ensure every tab's session data is
// properly isolated and cleaned up.
//
// Limitations (documented):
// 1. If the Electron process hard-crashes, in-memory partition temp files
//    may remain on disk. Next clean boot of the OS will clear them.
// 2. Chromium's partition cleanup is best-effort — some cache artifacts
//    in the temp directory may persist briefly.
// 3. We use in-memory (temporary) partitions — no persistent cookie/store data.
//    See: https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options

import { session as electronSession } from 'electron';
import { tabManager } from './tab-manager';

export class SessionManager {
  private initialized = false;

  /**
   * Initialize the session manager.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[SessionManager] Initialized.');
  }

  /**
   * Clear all session data for a specific partition.
   * Called when a tab is closed.
   */
  async clearPartitionData(partitionId: string): Promise<void> {
    try {
      const partitionSession = electronSession.fromPartition(partitionId);
      await partitionSession.clearStorageData();
      await partitionSession.clearCache();
      console.log(`[SessionManager] Cleared partition: ${partitionId}`);
    } catch (err) {
      console.error(`[SessionManager] Error clearing partition ${partitionId}:`, err);
    }
  }

  /**
   * Clear all session data across all open tabs.
   * Called on app quit or user request.
   */
  async clearAllSessions(): Promise<void> {
    const tabs = tabManager.listTabs();
    const partitions = new Set(tabs.map(t => t.partitionId));
    console.log(`[SessionManager] Clearing ${partitions.size} partitions...`);

    const promises = Array.from(partitions).map(p => this.clearPartitionData(p));
    await Promise.allSettled(promises);

    console.log('[SessionManager] All partitions cleared.');
  }

  /**
   * Check if a partition ID is safe to use (not already in use).
   * Partitions are UUID-based, so collision is practically impossible.
   */
  isPartitionIdSafe(partitionId: string): boolean {
    const existing = tabManager.listTabs();
    return !existing.some(t => t.partitionId === partitionId);
  }

  /**
   * Log current partition usage stats.
   */
  logPartitionStats(): void {
    const tabs = tabManager.listTabs();
    const guestCount = tabs.filter(t => t.type === 'guest').length;
    const loginCount = tabs.filter(t => t.type === 'login_entry').length;
    console.log(`[SessionManager] Partitions: ${tabs.length} total (${guestCount} guest, ${loginCount} login-entry)`);
  }
}

// Singleton
export const sessionManager = new SessionManager();
