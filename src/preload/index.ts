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

// IMPORTANT: This preload runs with `sandbox: true`. A sandboxed preload may
// only `require('electron')` and Node built-ins — it CANNOT require local
// project modules (doing so throws "module not found", the preload fails to
// load, and `window.pvbAPI` is never exposed, dropping the app into
// placeholder mode). So the IPC channel names are inlined here instead of
// imported from ../shared/types. Keep these values in sync with
// src/shared/types.ts (a test guards this — tests/ipc-channels-sync.test.ts).
const IPC_CHANNELS = {
  // Credentials
  CREDENTIALS_LIST:       'credentials:list',
  CREDENTIALS_CREATE:     'credentials:create',
  CREDENTIALS_UPDATE:     'credentials:update',
  CREDENTIALS_DELETE:     'credentials:delete',

  // Bookmarks
  BOOKMARKS_LIST:         'bookmarks:list',
  BOOKMARKS_CREATE:       'bookmarks:create',
  BOOKMARKS_DELETE:       'bookmarks:delete',
  BOOKMARKS_REORDER:      'bookmarks:reorder',
  BOOKMARKS_FOLDERS:      'bookmarks:folders',

  // Categories / folders
  CATEGORIES_LIST:        'categories:list',
  CATEGORIES_CREATE:      'categories:create',
  CATEGORIES_UPDATE:      'categories:update',
  CATEGORIES_DELETE:      'categories:delete',
  CATEGORIES_REORDER:     'categories:reorder',

  // Site Status
  STATUS_GET_FOR_DOMAIN:  'status:get-for-domain',
  STATUS_GET_ALL:         'status:get-all',

  // Tabs
  TAB_CREATE_GUEST:       'tab:create-guest',
  TAB_CREATE_LOGIN:       'tab:create-login',
  TAB_CLOSE:              'tab:close',
  TAB_SWITCH:             'tab:switch',
  TAB_NAVIGATE:           'tab:navigate',
  TAB_GO_BACK:            'tab:go-back',
  TAB_GO_FORWARD:         'tab:go-forward',
  TAB_REFRESH:            'tab:refresh',
  TAB_LIST:               'tab:list',
  TAB_UPDATE_URL:         'tab:update-url',

  // Overlay control
  VIEW_SET_OVERLAY:       'view:set-overlay',

  // Native bookmark-folder dropdown
  BOOKMARK_SHOW_FOLDER_MENU: 'bookmark:show-folder-menu',

  // Autofill
  AUTOFILL:               'autofill:execute',

  // Site Rules
  SITE_RULES_GET:         'site-rules:get',
  SITE_RULES_SET:         'site-rules:set',

  LOGIN_PAGE_LIST:        'login-page:list',
  LOGIN_PAGE_SAVE:        'login-page:save',
  LOGIN_PAGE_UPDATE:      'login-page:update',
  LOGIN_PAGE_DELETE:      'login-page:delete',
  LOGIN_PAGE_RESOLVE:     'login-page:resolve',
  LOGIN_PAGE_CONNECTION:  'login-page:connection',

  // Settings
  SETTINGS_SITE_ACCOUNTS: 'settings:site-accounts',
  SETTINGS_CLEAR_DATA:    'settings:clear-data',
  SETTINGS_SET_ACCOUNT_STATUS: 'settings:set-account-status',
  SETTINGS_CLEAR_ACCOUNT_TIMER: 'settings:clear-account-timer',
  SETTINGS_EXPORT_DATA:   'settings:export-data',
  SETTINGS_IMPORT_DATA:   'settings:import-data',

  // Downloads
  DOWNLOADS_LIST:         'downloads:list',
  DOWNLOADS_PAUSE:        'downloads:pause',
  DOWNLOADS_RESUME:       'downloads:resume',
  DOWNLOADS_CANCEL:       'downloads:cancel',
  DOWNLOADS_RETRY:        'downloads:retry',
  DOWNLOADS_OPEN_FILE:    'downloads:open-file',
  DOWNLOADS_SHOW_IN_FOLDER: 'downloads:show-in-folder',
  DOWNLOADS_REMOVE:       'downloads:remove',
  DOWNLOADS_DELETE_FILE:  'downloads:delete-file',
  DOWNLOADS_CLEAR:        'downloads:clear',
  DOWNLOADS_MARK_SEEN:    'downloads:mark-seen',
  DOWNLOADS_GET_SETTINGS: 'downloads:get-settings',
  DOWNLOADS_SET_SETTINGS: 'downloads:set-settings',
  DOWNLOADS_CHOOSE_DIR:   'downloads:choose-dir',

  // Events (main -> renderer)
  EVENT_TAB_CREATED:      'event:tab-created',
  EVENT_TAB_CLOSED:       'event:tab-closed',
  EVENT_TAB_SWITCHED:     'event:tab-switched',
  EVENT_TAB_URL_CHANGED:  'event:tab-url-changed',
  EVENT_PAGE_TITLE_CHANGED: 'event:page-title-changed',
  EVENT_NAVIGATION_STATE_CHANGED: 'event:nav-state-changed',
  EVENT_STATUS_CHANGED:   'event:status-changed',
  EVENT_LOAD_PROGRESS:    'event:load-progress',
  EVENT_DOWNLOAD_UPDATED: 'event:download-updated',
  EVENT_DOWNLOADS_CHANGED: 'event:downloads-changed',
  EVENT_BOOKMARKS_CHANGED: 'event:bookmarks-changed',
} as const;

// Define the API surface exposed to the renderer
const api = {
  // ---- Credentials ----
  credentials: {
    list: (domain?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_LIST, domain),
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
    folders: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_FOLDERS),
    showFolderMenu: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_SHOW_FOLDER_MENU, payload),
  },

  // ---- Categories / folders ----
  categories: {
    list: (domain?: string) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_LIST, domain),
    create: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_CREATE, data),
    update: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_UPDATE, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_DELETE, id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_REORDER, orderedIds),
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
    setOverlay: (visible: boolean) => ipcRenderer.invoke(IPC_CHANNELS.VIEW_SET_OVERLAY, visible),
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

  // Tell the main process which theme is active so loaded websites can follow
  // it via prefers-color-scheme (best-effort).
  sendTheme: (theme: 'light' | 'dark') => {
    ipcRenderer.send('browser:set-theme', theme);
  },

  // Tell the main process the current vault sidebar width so the web view is
  // repositioned when the sidebar collapses/expands.
  sendSidebarWidth: (width: number) => {
    ipcRenderer.send('browser:sidebar-width', width);
  },

  // ---- Site Rules ----
  siteRules: {
    get: (domain: string) => ipcRenderer.invoke(IPC_CHANNELS.SITE_RULES_GET, domain),
    set: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.SITE_RULES_SET, data),
  },

  // ---- Login-page mappings (Save Current Page as Login Page) ----
  loginPages: {
    list: (mainDomain?: string) => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PAGE_LIST, mainDomain),
    save: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PAGE_SAVE, req),
    update: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PAGE_UPDATE, req),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PAGE_DELETE, id),
    resolve: (currentUrl: string, loginEntryId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PAGE_RESOLVE, { currentUrl, loginEntryId }),
    connection: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PAGE_CONNECTION, url),
  },

  // ---- Settings ----
  settings: {
    siteAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SITE_ACCOUNTS),
    clearData: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CLEAR_DATA, req),
    setAccountStatus: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_ACCOUNT_STATUS, req),
    clearAccountTimer: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CLEAR_ACCOUNT_TIMER, req),
    exportData: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_EXPORT_DATA, req),
    importData: (req: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_IMPORT_DATA, req),
  },

  // ---- Downloads ----
  downloads: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_LIST),
    pause: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_PAUSE, id),
    resume: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_RESUME, id),
    cancel: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, id),
    retry: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_RETRY, id),
    openFile: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_OPEN_FILE, id),
    showInFolder: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER, id),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_REMOVE, id),
    deleteFile: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_DELETE_FILE, id),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CLEAR),
    markSeen: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_MARK_SEEN),
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_GET_SETTINGS),
    setSettings: (patch: any) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_SET_SETTINGS, patch),
    chooseDir: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CHOOSE_DIR),
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
      IPC_CHANNELS.EVENT_LOAD_PROGRESS,
      IPC_CHANNELS.EVENT_DOWNLOAD_UPDATED,
      IPC_CHANNELS.EVENT_DOWNLOADS_CHANGED,
      IPC_CHANNELS.EVENT_BOOKMARKS_CHANGED,
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
