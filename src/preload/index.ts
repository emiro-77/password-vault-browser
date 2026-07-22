// ============================================================================
// Preload Script — Main Window
// ============================================================================
// This script runs in the renderer process (the app's own UI).
// It exposes a safe, typed API via contextBridge.
// nodeIntegration is disabled, contextIsolation is enabled.
//
// The exposed `window.pvbAPI` provides the full IPC interface for the
// renderer to communicate with the main process.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';

// Define the API surface exposed to the renderer
const api = {
  // ---- Credentials ----
  credentials: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_LIST),
    create: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_CREATE, data),
    update: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_UPDATE, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_DELETE, id),
  },

  // ---- Bookmarks ----
  bookmarks: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_LIST),
    create: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_CREATE, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_DELETE, id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_REORDER, orderedIds),
  },

  // ---- Site Status ----
  status: {
    getForDomain: (domain: string) => ipcRenderer.invoke(IPC_CHANNELS.STATUS_GET_FOR_DOMAIN, domain),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.STATUS_GET_ALL),
  },

  // ---- Tabs ----
  tabs: {
    createGuest: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE_GUEST),
    createLogin: (loginEntryId: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE_LOGIN, { loginEntryId, url }),
    close: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, tabId),
    switch: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_SWITCH, tabId),
    navigate: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_NAVIGATE, url),
    goBack: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_GO_BACK),
    goForward: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_GO_FORWARD),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_REFRESH),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_LIST),
  },

  // ---- Autofill ----
  autofill: {
    execute: (tabId: string, loginEntryId: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOFILL, { tabId, loginEntryId, url }),
  },

  // ---- UI Coordination ----
  sendChromeHeight: (height: number) => {
    ipcRenderer.send('browser:chrome-height', height);
  },

  // ---- Site Rules ----
  siteRules: {
    get: (domain: string) => ipcRenderer.invoke(IPC_CHANNELS.SITE_RULES_GET, domain),
    set: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.SITE_RULES_SET, data),
  },

  // ---- Event Listeners ----
  on: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = [
      IPC_CHANNELS.EVENT_TAB_CREATED,
      IPC_CHANNELS.EVENT_TAB_CLOSED,
      IPC_CHANNELS.EVENT_TAB_SWITCHED,
      IPC_CHANNELS.EVENT_TAB_URL_CHANGED,
      IPC_CHANNELS.EVENT_PAGE_TITLE_CHANGED,
      IPC_CHANNELS.EVENT_NAVIGATION_STATE_CHANGED,
      IPC_CHANNELS.EVENT_STATUS_CHANGED,
    ];

    if (validChannels.includes(channel as any)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }

    console.warn(`[Preload] Blocked listener for unauthorized channel: ${channel}`);
    return () => {};
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('pvbAPI', api);
