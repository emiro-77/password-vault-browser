export type LoginStatus = 'never_used' | 'logged_in' | 'expired' | 'login_failed' | 'needs_2fa' | 'active_tab_open';
export interface LoginEntry {
    id: string;
    label: string;
    usernameOrEmail: string;
    createdAt: string;
    updatedAt: string;
}
export interface LoginEntryCreateRequest {
    label: string;
    usernameOrEmail: string;
    password: string;
}
export interface LoginEntryUpdateRequest {
    id: string;
    label?: string;
    usernameOrEmail?: string;
    password?: string;
}
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
export interface AutofillRequest {
    tabId: string;
    url: string;
    username: string;
    password: string;
}
export declare const IPC_CHANNELS: {
    readonly CREDENTIALS_LIST: "credentials:list";
    readonly CREDENTIALS_CREATE: "credentials:create";
    readonly CREDENTIALS_UPDATE: "credentials:update";
    readonly CREDENTIALS_DELETE: "credentials:delete";
    readonly BOOKMARKS_LIST: "bookmarks:list";
    readonly BOOKMARKS_CREATE: "bookmarks:create";
    readonly BOOKMARKS_DELETE: "bookmarks:delete";
    readonly BOOKMARKS_REORDER: "bookmarks:reorder";
    readonly STATUS_GET_FOR_DOMAIN: "status:get-for-domain";
    readonly STATUS_GET_ALL: "status:get-all";
    readonly TAB_CREATE_GUEST: "tab:create-guest";
    readonly TAB_CREATE_LOGIN: "tab:create-login";
    readonly TAB_CLOSE: "tab:close";
    readonly TAB_SWITCH: "tab:switch";
    readonly TAB_NAVIGATE: "tab:navigate";
    readonly TAB_GO_BACK: "tab:go-back";
    readonly TAB_GO_FORWARD: "tab:go-forward";
    readonly TAB_REFRESH: "tab:refresh";
    readonly TAB_LIST: "tab:list";
    readonly TAB_UPDATE_URL: "tab:update-url";
    readonly AUTOFILL: "autofill:execute";
    readonly SITE_RULES_GET: "site-rules:get";
    readonly SITE_RULES_SET: "site-rules:set";
    readonly EVENT_TAB_CREATED: "event:tab-created";
    readonly EVENT_TAB_CLOSED: "event:tab-closed";
    readonly EVENT_TAB_SWITCHED: "event:tab-switched";
    readonly EVENT_TAB_URL_CHANGED: "event:tab-url-changed";
    readonly EVENT_PAGE_TITLE_CHANGED: "event:page-title-changed";
    readonly EVENT_NAVIGATION_STATE_CHANGED: "event:nav-state-changed";
};
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
export interface DomainMatchResult {
    exactDomain: string;
    isSecure: boolean;
}
export interface AutofillScriptMessage {
    type: 'pvb-autofill';
    username: string;
    password: string;
}
