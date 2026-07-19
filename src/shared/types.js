// ============================================================================
// Shared Types for Password Vault Browser
// ============================================================================
// These types are used by both main and renderer processes via IPC.
// No secrets or passwords are exposed in these shared types.
// ---- IPC Channel Names ----
export const IPC_CHANNELS = {
    // Credentials
    CREDENTIALS_LIST: 'credentials:list',
    CREDENTIALS_CREATE: 'credentials:create',
    CREDENTIALS_UPDATE: 'credentials:update',
    CREDENTIALS_DELETE: 'credentials:delete',
    // Bookmarks
    BOOKMARKS_LIST: 'bookmarks:list',
    BOOKMARKS_CREATE: 'bookmarks:create',
    BOOKMARKS_DELETE: 'bookmarks:delete',
    BOOKMARKS_REORDER: 'bookmarks:reorder',
    // Site Status
    STATUS_GET_FOR_DOMAIN: 'status:get-for-domain',
    STATUS_GET_ALL: 'status:get-all',
    // Tabs
    TAB_CREATE_GUEST: 'tab:create-guest',
    TAB_CREATE_LOGIN: 'tab:create-login',
    TAB_CLOSE: 'tab:close',
    TAB_SWITCH: 'tab:switch',
    TAB_NAVIGATE: 'tab:navigate',
    TAB_GO_BACK: 'tab:go-back',
    TAB_GO_FORWARD: 'tab:go-forward',
    TAB_REFRESH: 'tab:refresh',
    TAB_LIST: 'tab:list',
    TAB_UPDATE_URL: 'tab:update-url',
    // Autofill
    AUTOFILL: 'autofill:execute',
    // Site Rules (future extension)
    SITE_RULES_GET: 'site-rules:get',
    SITE_RULES_SET: 'site-rules:set',
    // Events (main -> renderer)
    EVENT_TAB_CREATED: 'event:tab-created',
    EVENT_TAB_CLOSED: 'event:tab-closed',
    EVENT_TAB_SWITCHED: 'event:tab-switched',
    EVENT_TAB_URL_CHANGED: 'event:tab-url-changed',
    EVENT_PAGE_TITLE_CHANGED: 'event:page-title-changed',
    EVENT_NAVIGATION_STATE_CHANGED: 'event:nav-state-changed',
};
//# sourceMappingURL=types.js.map