// ============================================================================
// Categories IPC Handlers
// ============================================================================

import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  IpcResponse,
  CategoryCreateRequest,
  CategoryUpdateRequest,
} from '../../shared/types';
import { categoryManager } from '../services/category-manager';

export function registerCategoriesIpc(): void {
  // List categories visible for a site: all global + this site's private ones.
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_LIST, async (_event, domain?: string): Promise<IpcResponse> => {
    try {
      return { success: true, data: categoryManager.listForDomain(domain) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CATEGORIES_CREATE, async (_event, request: CategoryCreateRequest): Promise<IpcResponse> => {
    try {
      return { success: true, data: categoryManager.create(request) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CATEGORIES_UPDATE, async (_event, request: CategoryUpdateRequest): Promise<IpcResponse> => {
    try {
      const cat = categoryManager.update(request);
      if (!cat) return { success: false, error: 'Category not found' };
      return { success: true, data: cat };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CATEGORIES_DELETE, async (_event, id: string): Promise<IpcResponse> => {
    try {
      return { success: true, data: { deleted: categoryManager.delete(id) } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CATEGORIES_REORDER, async (_event, orderedIds: string[]): Promise<IpcResponse> => {
    try {
      categoryManager.reorder(orderedIds);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
