// ============================================================================
// Type declarations for the renderer's window.pvbAPI
// ============================================================================

import { IpcResponse, LoginEntry, Bookmark, SiteLoginStatus, TabInfo, Category, CategoryCreateRequest, CategoryUpdateRequest, SiteAccountsGroup, ClearDataRequest, ClearDataResult, SetAccountStatusRequest, ClearAccountTimerRequest, ExportDataRequest, ExportDataResult, ImportDataRequest, ImportDataResult, LoginPageMapping, SaveLoginPageRequest, ResolvedLoginPage } from '../shared/types';

export interface PvbAPI {
  credentials: {
    list: (domain?: string) => Promise<IpcResponse<LoginEntry[]>>;
    create: (data: { label: string; usernameOrEmail: string; password: string; domain?: string }) => Promise<IpcResponse<LoginEntry>>;
    update: (data: { id: string; label?: string; usernameOrEmail?: string; password?: string }) => Promise<IpcResponse<LoginEntry>>;
    delete: (id: string) => Promise<IpcResponse>;
  };

  bookmarks: {
    list: () => Promise<IpcResponse<Bookmark[]>>;
    create: (data: { title: string; url: string }) => Promise<IpcResponse<Bookmark>>;
    delete: (id: string) => Promise<IpcResponse>;
    reorder: (orderedIds: string[]) => Promise<IpcResponse>;
  };

  categories: {
    list: (domain?: string) => Promise<IpcResponse<Category[]>>;
    create: (data: CategoryCreateRequest) => Promise<IpcResponse<Category>>;
    update: (data: CategoryUpdateRequest) => Promise<IpcResponse<Category>>;
    delete: (id: string) => Promise<IpcResponse>;
    reorder: (orderedIds: string[]) => Promise<IpcResponse>;
  };

  status: {
    getForDomain: (domain: string) => Promise<IpcResponse<(SiteLoginStatus & { loginLabel: string; loginUsername: string })[]>>;
    getAll: () => Promise<IpcResponse<(SiteLoginStatus & { loginLabel: string; loginUsername: string })[]>>;
  };

  tabs: {
    createGuest: () => Promise<IpcResponse<TabInfo>>;
    createLogin: (loginEntryId: string, url: string) => Promise<IpcResponse<TabInfo & { switched?: boolean }>>;
    close: (tabId: string) => Promise<IpcResponse>;
    switch: (tabId: string) => Promise<IpcResponse>;
    navigate: (url: string) => Promise<IpcResponse>;
    goBack: () => Promise<IpcResponse>;
    goForward: () => Promise<IpcResponse>;
    refresh: () => Promise<IpcResponse>;
    list: () => Promise<IpcResponse<TabInfo[]>>;
    setOverlay: (visible: boolean) => Promise<IpcResponse>;
  };

  autofill: {
    execute: (tabId: string, loginEntryId: string, url: string) => Promise<IpcResponse>;
  };

  settings: {
    siteAccounts: () => Promise<IpcResponse<SiteAccountsGroup[]>>;
    clearData: (req: ClearDataRequest) => Promise<IpcResponse<ClearDataResult>>;
    setAccountStatus: (req: SetAccountStatusRequest) => Promise<IpcResponse>;
    clearAccountTimer: (req: ClearAccountTimerRequest) => Promise<IpcResponse>;
    exportData: (req: ExportDataRequest) => Promise<IpcResponse<ExportDataResult>>;
    importData: (req: ImportDataRequest) => Promise<IpcResponse<ImportDataResult>>;
  };

  loginPages: {
    list: (mainDomain?: string) => Promise<IpcResponse<LoginPageMapping[]>>;
    save: (req: SaveLoginPageRequest) => Promise<IpcResponse<LoginPageMapping>>;
    delete: (id: string) => Promise<IpcResponse<{ deleted: boolean }>>;
    resolve: (currentUrl: string, loginEntryId: string) => Promise<IpcResponse<ResolvedLoginPage | null>>;
  };

  sendChromeHeight: (height: number) => void;
  sendTheme: (theme: 'light' | 'dark') => void;
  sendSidebarWidth: (width: number) => void;

  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

// Declare webview tag type for the renderer process
// (Electron types are not available in the renderer tsconfig)
export interface WebviewTag {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  isDevToolsOpened(): boolean;
  openDevTools(): void;
  closeDevTools(): void;
  addEventListener(event: string, listener: (...args: any[]) => void): void;
  removeEventListener(event: string, listener: (...args: any[]) => void): void;
  executeJavaScript(code: string): Promise<any>;
  send(channel: string, ...args: any[]): void;
  style: CSSStyleDeclaration;
  src?: string;
}

declare global {
  interface Window {
    pvbAPI: PvbAPI;
  }
}
