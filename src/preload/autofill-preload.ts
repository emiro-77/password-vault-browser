// ============================================================================
// Autofill Preload Script — Injected into webview content pages
// ============================================================================
// This script runs inside each webview's page context (the actual website).
// It provides a secure channel for the main process to send autofill commands.
//
// Security:
// - nodeIntegration: false
// - contextIsolation: true
// - This script runs with privileged access but the page does not
// - We only expose a minimal IPC channel for autofill events
//
// The autofill content script (in autofill-engine.ts) is injected directly
// via executeJavaScript() in the main process, NOT via this preload.
// This preload is a fallback for future IPC-based approaches.

import { contextBridge, ipcRenderer } from 'electron';

// Minimal API for autofill — just a listener for autofill commands
contextBridge.exposeInMainWorld('__pvbAutofill', {
  // Listen for autofill commands from the main process
  onAutofill: (callback: (username: string, password: string) => void) => {
    ipcRenderer.on('autofill:fill', (_event, username: string, password: string) => {
      callback(username, password);
    });
  },
});
