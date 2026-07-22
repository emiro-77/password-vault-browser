// ============================================================================
// Application Constants
// ============================================================================

export const APP_NAME = 'Password Vault Browser';
export const APP_VERSION = '0.3.0';
export const APP_CODE_NAME = 'pvb';

export const DB_FILENAME = 'pvb-data.db';

export const CREDENTIAL_SERVICE_NAME = 'password-vault-browser';

/** How long a "logged_in" status lasts after autofill (24 hours) */
export const LOGGED_IN_DURATION_MS = 24 * 60 * 60 * 1000;

/** Partition prefix for guest tabs */
export const PARTITION_PREFIX_GUEST = 'pvb-guest-';

/** Partition prefix for login-entry tabs */
export const PARTITION_PREFIX_LOGIN = 'pvb-login-';

/** Default width/height for the browser window */
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;

/** Min window size */
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

/** Sidebar width */
export const SIDEBAR_WIDTH = 280;

/** Preload script path for webview content */
export const AUTOFILL_PRELOAD = 'autofill-preload.js';
