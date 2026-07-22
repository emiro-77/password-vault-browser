// ============================================================================
// WebContents navigation helpers
// ============================================================================
// Electron 33 deprecated `webContents.canGoBack()` / `canGoForward()` /
// `goBack()` / `goForward()` in favor of the `navigationHistory` API. Calling
// the old methods logs deprecation warnings and they are slated for removal.
//
// These helpers use `navigationHistory` when available and fall back to the
// legacy methods otherwise, so the app works across Electron versions.

import type { WebContents } from 'electron';

export function canGoBack(wc: WebContents): boolean {
  const nav = (wc as any).navigationHistory;
  if (nav && typeof nav.canGoBack === 'function') {
    return nav.canGoBack();
  }
  return typeof (wc as any).canGoBack === 'function' ? (wc as any).canGoBack() : false;
}

export function canGoForward(wc: WebContents): boolean {
  const nav = (wc as any).navigationHistory;
  if (nav && typeof nav.canGoForward === 'function') {
    return nav.canGoForward();
  }
  return typeof (wc as any).canGoForward === 'function' ? (wc as any).canGoForward() : false;
}

export function goBack(wc: WebContents): void {
  const nav = (wc as any).navigationHistory;
  if (nav && typeof nav.goBack === 'function') {
    nav.goBack();
    return;
  }
  if (typeof (wc as any).goBack === 'function') {
    (wc as any).goBack();
  }
}

export function goForward(wc: WebContents): void {
  const nav = (wc as any).navigationHistory;
  if (nav && typeof nav.goForward === 'function') {
    nav.goForward();
    return;
  }
  if (typeof (wc as any).goForward === 'function') {
    (wc as any).goForward();
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure geometry: compute the BrowserView content bounds given the window
 * content size, the sidebar width (left) and the chrome height (top).
 * Clamps to non-negative width/height. Kept pure so it is unit-testable.
 */
export function computeViewBounds(
  contentWidth: number,
  contentHeight: number,
  sidebarWidth: number,
  chromeHeight: number
): Rect {
  const x = Math.max(0, sidebarWidth);
  const y = Math.max(0, chromeHeight);
  return {
    x,
    y,
    width: Math.max(0, contentWidth - x),
    height: Math.max(0, contentHeight - y),
  };
}
