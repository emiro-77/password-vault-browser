// ============================================================================
// Password Vault Browser — Electron Main Process Entry
// ============================================================================
//
// This is the main process entry point for the Electron application.
// It:
// 1. Creates the main browser window
// 2. Initializes the database and credential store
// 3. Registers all IPC handlers
// 4. Creates an initial guest tab
// 5. Handles app lifecycle (close, window events)

import { app, BrowserWindow, screen, ipcMain, nativeTheme, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase, closeDatabase } from './db';
import { initCredentialStore } from './services/credential-store';
import { registerAllIpcHandlers } from './ipc';
import { tabManager } from './services/tab-manager';
import { sessionManager } from './services/session-manager';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  APP_NAME,
} from '../shared/constants';

let mainWindow: BrowserWindow | null = null;

// ---- Performance: Chromium command-line switches ----
// These are set before `app.whenReady()` so they take effect for every
// BrowserView/webContents the app creates. They meaningfully speed up page
// rendering and scrolling on typical desktop hardware.
//   - enable GPU rasterization + zero-copy so compositing is done on the GPU
//   - ignore the GPU blocklist so hardware accel is used on more machines
//   - a larger disk cache so repeat visits and sub-resources load from cache
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('disk-cache-size', String(256 * 1024 * 1024)); // 256 MB

/**
 * Create the main application window.
 */
/**
 * Resolve the runtime window/taskbar icon. Packaged builds have it at
 * dist/icon.png (bundled by copy-assets); dev falls back to resources/icon.png.
 */
function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../icon.png'),          // dist/icon.png (packaged)
    path.join(__dirname, '../../resources/icon.png'), // dev source
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return undefined;
}

function createMainWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(DEFAULT_WINDOW_WIDTH, screenWidth),
    height: Math.min(DEFAULT_WINDOW_HEIGHT, screenHeight),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: APP_NAME,
    icon: resolveWindowIcon(),
    backgroundColor: '#1e1e2e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Surface preload failures loudly — a failed preload means window.pvbAPI is
  // never exposed and the UI silently falls back to placeholder mode.
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[Main] PRELOAD FAILED to load: ${preloadPath}\n`, error);
  });

  // Open DevTools automatically when launched in dev/debug so console errors
  // (incl. preload issues) are visible. Set PVB_DEVTOOLS=1 to force it.
  if (!app.isPackaged || process.env.PVB_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Load the renderer (the app's own UI shell)
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window resize -> update BrowserView bounds
  mainWindow.on('resize', () => {
    // The renderer will communicate chrome height via IPC;
    // for now the renderer tells us via the bound update channel.
    mainWindow?.webContents.send('window:resized');
  });

  // Attach tab manager to the window
  tabManager.attachToWindow(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log(`[Main] Window created (${DEFAULT_WINDOW_WIDTH}x${DEFAULT_WINDOW_HEIGHT})`);
}

/**
 * Initialize all services.
 */
async function initializeServices(): Promise<void> {
  console.log('[Main] Initializing services...');

  // 1. Database
  initDatabase();
  console.log('[Main] Database initialized.');

  // 2. Credential store (Windows Credential Manager or fallback)
  await initCredentialStore();

  // 3. Session manager
  sessionManager.init();

  // 4. Register all IPC handlers
  registerAllIpcHandlers();

  // 4.5 Purge stale runtime tab state from a previous session (crash / hard
  //     kill leaves orphaned `tabs` rows and phantom active_tab_id links).
  //     Doing this at boot — before any tab exists — guarantees "Active tab"
  //     starts from a clean slate and reflects only genuinely-open tabs.
  tabManager.purgeOrphanedPersistedTabs();
  tabManager.reconcileStatusActiveTabs();

  // 5. Update view bounds whenever the renderer tells us chrome height
  ipcMain.on('browser:chrome-height', (_event: any, chromeHeight: number) => {
    tabManager.updateActiveViewBounds(chromeHeight);
  });

  // 6. Theme: propagate the chosen theme to Chromium's nativeTheme so loaded
  //    websites that honor `prefers-color-scheme` follow the app theme too.
  ipcMain.on('browser:set-theme', (_event: any, theme: 'light' | 'dark') => {
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  });

  // 7. Sidebar width: reposition the active web view when the vault sidebar
  //    collapses/expands so the BrowserView follows the shell layout.
  ipcMain.on('browser:sidebar-width', (_event: any, sidebarWidth: number) => {
    tabManager.updateSidebarWidth(sidebarWidth);
  });

  console.log('[Main] All services initialized.');
}

// ---- App lifecycle ----

app.whenReady().then(async () => {
  try {
    await initializeServices();
    createMainWindow();
  } catch (err) {
    // Surface the failure loudly. A silent app.quit() here is what causes the
    // "nothing happened — no window, no error" symptom in packaged builds when
    // a native module (e.g. better-sqlite3) fails to load. Show a dialog so the
    // failure is visible and diagnosable before we exit.
    const detail = err instanceof Error ? (err.stack || err.message) : String(err);
    console.error('[Main] Fatal error during initialization:', err);
    try {
      dialog.showErrorBox(
        `${APP_NAME} failed to start`,
        `The application could not initialize and will now close.\n\n${detail}`
      );
    } catch {
      /* dialog may be unavailable in some edge cases — ignore */
    }
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  // Clean up all tabs and their sessions
  console.log('[Main] Cleaning up before quit...');
  await tabManager.closeAllTabs();
  await sessionManager.clearAllSessions();
  closeDatabase();

  // On Windows, quit explicitly (not typical for macOS)
  app.quit();
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (!mainWindow) {
    createMainWindow();
  }
});

app.on('before-quit', async () => {
  console.log('[Main] App quitting...');
  await tabManager.closeAllTabs();
  await sessionManager.clearAllSessions();
  closeDatabase();
});
