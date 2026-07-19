// ============================================================================
// Bookmarks IPC Handlers
// ============================================================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS, IpcResponse, BookmarkCreateRequest } from '../../shared/types';
import { bookmarkManager } from '../services/bookmark-manager';

export function registerBookmarksIpc(): void {
  // List all bookmarks
  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_LIST, async (): Promise<IpcResponse> => {
    try {
      const bookmarks = bookmarkManager.listAll();
      return { success: true, data: bookmarks };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Create a bookmark
  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_CREATE, async (_event, request: BookmarkCreateRequest): Promise<IpcResponse> => {
    try {
      const bookmark = bookmarkManager.create(request);
      return { success: true, data: bookmark };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Delete a bookmark
  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_DELETE, async (_event, id: string): Promise<IpcResponse> => {
    try {
      const deleted = bookmarkManager.delete(id);
      return { success: true, data: { deleted } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Reorder bookmarks
  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_REORDER, async (_event, orderedIds: string[]): Promise<IpcResponse> => {
    try {
      bookmarkManager.reorder(orderedIds);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
