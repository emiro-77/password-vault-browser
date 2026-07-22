// ============================================================================
// Shared Types for Password Vault Browser
// ============================================================================
// These types are used by both main and renderer processes via IPC.
// No secrets or passwords are exposed in these shared types.

// ---- Login Status Enum ----

export type LoginStatus =
  | 'never_used'
  | 'logged_in'
  | 'expired'
  | 'login_failed'
  | 'needs_2fa'
  | 'active_tab_open';

// ---- Global Login Entry ----

export interface LoginEntry {
  id: string;
  label: string;
  usernameOrEmail: string;
  // password_secret_ref is main-process-only — never sent to renderer
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export interface LoginEntryCreateRequest {
  label: string;
  usernameOrEmail: string;
  password: string;    // only sent once during create/update
}

export interface LoginEntryUpdateRequest {
  id: string;
  label?: string;
  usernameOrEmail?: string;
  password?: string;
}

// The renderer never receives the password.
// Autofill happens via a dedicated IPC channel to the main process.

// ---- Site-Specific Login Status ----

export interface SiteLoginStatus {
  id: string;
  loginEntryId: string;
  domain: string;
  status: LoginStatus;
  firstLoginAt: string | null;
  loggedInUntil: string | null;
  lastUsedAt: string | null;
  activeTabId: string | null;
}

// ---- Bookmark ----

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  position: number;
  createdAt: string;
}

export interface BookmarkCreateRequest {
  title: string;
  url: string;
}

// ---- Tab ----

export type TabType = 'guest' | 'login_entry';

export interface TabInfo {
  id: string;
  type: TabType;
  currentUrl: string;
  domain: string | null;
  loginEntryId: string | null;
  partitionId: string;
  createdAt: string;
  lastActiveAt: string;
}

// ---- Autofill ----

export interface AutofillRequest {
  tabId: string;
  url: string;
  username: string;
  password: string;
}

// ---- IPC Channel Names ----

export const IPC_CHANNELS = {
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

  // Autofill
  AUTOFILL:               'autofill:execute',

  // Site Rules (future extension)
  SITE_RULES_GET:         'site-rules:get',
  SITE_RULES_SET:         'site-rules:set',

  // Events (main -> renderer)
  EVENT_TAB_CREATED:      'event:tab-created',
  EVENT_TAB_CLOSED:       'event:tab-closed',
  EVENT_TAB_SWITCHED:     'event:tab-switched',
  EVENT_TAB_URL_CHANGED:  'event:tab-url-changed',
  EVENT_PAGE_TITLE_CHANGED: 'event:page-title-changed',
  EVENT_NAVIGATION_STATE_CHANGED: 'event:nav-state-changed',
  EVENT_STATUS_CHANGED:   'event:status-changed',
} as const;

// ---- IPC Request / Response Types ----

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  currentUrl: string;
  isLoading: boolean;
}

export interface PageInfo {
  tabId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

// ---- Domain matching ----

export interface DomainMatchResult {
  exactDomain: string;
  isSecure: boolean;
}

// ---- Autofill script message ----

export interface AutofillScriptMessage {
  type: 'pvb-autofill';
  username: string;
  password: string;
}
