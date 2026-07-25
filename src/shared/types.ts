// ============================================================================
// Shared Types for Password Vault Browser
// ============================================================================
// These types are used by both main and renderer processes via IPC.
// No secrets or passwords are exposed in these shared types.

// ---- Login Status Enum ----

export type LoginStatus =
  | 'never_used'
  | 'logged_in'
  | 'used'            // was the active account, then superseded (shown red)
  | 'expired'
  | 'login_failed'
  | 'needs_2fa'
  | 'active_tab_open';

// ---- Global Login Entry ----

export interface LoginEntry {
  id: string;
  label: string;
  usernameOrEmail: string;
  domain: string;      // site this account belongs to ('' = unscoped/legacy)
  // password_secret_ref is main-process-only — never sent to renderer
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export interface LoginEntryCreateRequest {
  label: string;
  usernameOrEmail: string;
  password: string;    // only sent once during create/update
  domain?: string;     // site this account belongs to
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

// ---- Categories / Folders ----

export type CategoryScope = 'global' | 'private';

export interface Category {
  id: string;
  name: string;
  icon: string;               // emoji/glyph or data: URL for a custom icon
  scope: CategoryScope;
  domain: string;             // '' for global; site host for private
  position: number;
  accountIds: string[];       // login entry ids that belong to this category
  createdAt: string;
  updatedAt: string;
}

export interface CategoryCreateRequest {
  name: string;
  icon?: string;
  scope: CategoryScope;
  domain?: string;            // required (site host) when scope === 'private'
  accountIds?: string[];
}

export interface CategoryUpdateRequest {
  id: string;
  name?: string;
  icon?: string;
  scope?: CategoryScope;
  domain?: string;
  accountIds?: string[];
}

// ---- Login-page mappings (Save Current Page as Login Page) ----

/**
 * Connects a MAIN website (eTLD+1) to the exact login-page URL that should be
 * opened + autofilled when an account is selected on the main site or any
 * nested/related page.
 */
export interface LoginPageMapping {
  id: string;
  mainDomain: string;            // eTLD+1 of the main website, e.g. 'chatgpt.com'
  loginUrl: string;              // full URL of the login page to open + autofill
  loginDomain: string;           // eTLD+1 of loginUrl = CANONICAL account key
  relatedUrls: string[];         // extra related roots (host or host/path)
  categoryId: string | null;     // restrict to this category (when restricted)
  categoryRestricted: boolean;   // true = only accounts in categoryId may use it
  createdAt: string;
  updatedAt: string;
}

export interface SaveLoginPageRequest {
  mainDomain: string;            // chosen main website (eTLD+1)
  loginUrl: string;              // the current page being saved as the login page
  relatedUrls?: string[];        // optional extra related roots
  categoryId?: string | null;    // optional category
  categoryRestricted?: boolean;  // default false = any account can use it
}

/** Partial update to an existing mapping (from Settings in-place editor). */
export interface UpdateLoginPageRequest {
  id: string;
  mainDomain?: string;
  loginUrl?: string;
  relatedUrls?: string[];
  categoryId?: string | null;
  categoryRestricted?: boolean;
}

/** Result of resolving whether a selected account should open a saved login page. */
export interface ResolvedLoginPage {
  mappingId: string;
  mainDomain: string;
  loginUrl: string;
}

/**
 * The connection context for the CURRENTLY-viewed URL, used by the vault
 * sidebar to switch between the 3 scenarios and to load accounts from the right
 * canonical domain.
 *   - 'login'      : the current page IS a saved login page.
 *   - 'connected'  : current page is the main website or a related/nested URL
 *                    that is linked to a saved login page.
 *   - 'standalone' : no login-page association.
 */
export interface LoginConnection {
  scenario: 'login' | 'connected' | 'standalone';
  /** Canonical domain accounts/status/categories should be loaded under. */
  accountDomain: string;
  mappingId: string | null;
  mainDomain: string | null;
  loginUrl: string | null;
  loginDomain: string | null;
  relatedUrls: string[];
}

// ---- Settings: site account management ----

/** One account row within a site group, with its current per-site status. */
export interface SiteAccountInfo {
  loginEntryId: string;
  label: string;
  usernameOrEmail: string;
  status: LoginStatus;          // computed per-site status for this domain
  lastUsedAt: string | null;
  loggedInUntil: string | null; // end of the 24h window (null = no timer)
  isActiveTab: boolean;         // true = the single active tab (status cannot be changed)
}

/** Request to change an account's per-site status from Settings. */
export interface SetAccountStatusRequest {
  loginEntryId: string;
  domain: string;
  status: LoginStatus;
}

/** Request to clear (delete) an account's 24h time-remaining data. */
export interface ClearAccountTimerRequest {
  loginEntryId: string;
  domain: string;
}

/** A site (domain) and the accounts saved for it. */
export interface SiteAccountsGroup {
  domain: string;               // '' for unscoped/legacy accounts
  accounts: SiteAccountInfo[];
  // Login-page mapping info (present when this domain is a saved login page).
  // Lets Settings visually distinguish login sites, show their main/related
  // URLs, and open the in-place editor.
  loginMapping?: LoginPageMapping | null;
}

/** What kinds of browsing data to clear. */
export interface ClearDataRequest {
  cache?: boolean;              // HTTP cache
  cookies?: boolean;            // cookies + site storage (localStorage, etc.)
  storage?: boolean;            // IndexedDB / service workers / caches
  vault?: boolean;             // saved accounts, bookmarks, saved login pages,
                               // per-site status, categories & site rules
}

export interface ClearDataResult {
  cleared: string[];            // human-readable list of what was cleared
}

// ---- Data export / import (encrypted, cross-platform backup) ----

export interface ExportDataRequest {
  passphrase: string;           // encrypts the backup file
}

export interface ExportDataResult {
  canceled?: boolean;           // user dismissed the save dialog
  filePath?: string;            // where the backup was written
  accounts?: number;            // counts, for the success message
  categories?: number;
  bookmarks?: number;
}

export interface ImportDataRequest {
  passphrase: string;           // decrypts the chosen backup file
}

export interface ImportDataResult {
  canceled?: boolean;           // user dismissed the open dialog
  accounts?: number;            // counts imported (overwrote the vault)
  categories?: number;
  bookmarks?: number;
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
  /** Live page title (from the page's <title>); used for the tab label. */
  title?: string;
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

  // Overlay control — hide the web view so shell modals are interactive
  VIEW_SET_OVERLAY:       'view:set-overlay',

  // Autofill
  AUTOFILL:               'autofill:execute',

  // Site Rules (future extension)
  SITE_RULES_GET:         'site-rules:get',
  SITE_RULES_SET:         'site-rules:set',

  // Login-page mappings (Save Current Page as Login Page)
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

  // Events (main -> renderer)
  EVENT_TAB_CREATED:      'event:tab-created',
  EVENT_TAB_CLOSED:       'event:tab-closed',
  EVENT_TAB_SWITCHED:     'event:tab-switched',
  EVENT_TAB_URL_CHANGED:  'event:tab-url-changed',
  EVENT_PAGE_TITLE_CHANGED: 'event:page-title-changed',
  EVENT_NAVIGATION_STATE_CHANGED: 'event:nav-state-changed',
  EVENT_STATUS_CHANGED:   'event:status-changed',
  EVENT_LOAD_PROGRESS:    'event:load-progress',
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
