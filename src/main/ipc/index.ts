// ============================================================================
// IPC Hub — registers all IPC handlers
// ============================================================================

import { registerCredentialsIpc } from './credentials.ipc';
import { registerBookmarksIpc } from './bookmarks.ipc';
import { registerCategoriesIpc } from './categories.ipc';
import { registerStatusIpc } from './status.ipc';
import { registerTabsIpc } from './tabs.ipc';
import { registerAutofillIpc } from './autofill.ipc';
import { registerSiteRulesIpc } from './site-rules.ipc';
import { registerSettingsIpc } from './settings.ipc';
import { registerLoginPageIpc } from './login-page.ipc';

/**
 * Register all IPC handlers for the application.
 * Call this once during app initialization.
 */
export function registerAllIpcHandlers(): void {
  console.log('[IPC] Registering all IPC handlers...');

  registerCredentialsIpc();
  registerBookmarksIpc();
  registerCategoriesIpc();
  registerStatusIpc();
  registerTabsIpc();
  registerAutofillIpc();
  registerSiteRulesIpc();
  registerSettingsIpc();
  registerLoginPageIpc();

  console.log('[IPC] All IPC handlers registered.');
}
