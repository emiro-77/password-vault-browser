// ============================================================================
// Autofill Engine — Detects login fields and injects credentials
// ============================================================================
//
// Design:
// 1. When a user selects a credential for autofill, the renderer sends an
//    IPC request to the main process.
// 2. The main process gets the password from secure storage (CredentialStore).
// 3. The main process injects a content script into the webview's WebContents
//    that finds login fields and fills them with proper DOM events.
// 4. The content script dispatches native input/change events for framework
//    compatibility (React, Vue, Angular).
//
// Security:
// - Password never touches the renderer process (only goes to webview content).
// - Hostname is validated before autofill — exact match required.
// - The preload script for webviews exposes only the autofill channel.

import { BrowserView } from 'electron';
import { extractHostname, hostnameMatches, extractDomain } from './domain-utils';
import { getCredential } from './credential-store';
import { AutofillRequest } from '../../shared/types';
import { getDatabase } from '../db';

// ---- Site-Specific Rule Types ----

export interface SiteAutofillRule {
  domain: string;
  loginUrlPattern: string | null;
  usernameSelector: string | null;
  passwordSelector: string | null;
  submitSelector: string | null;
  successIndicatorSelector: string | null;
}

/**
 * Load site-specific autofill rules from the database.
 * Returns null if no rules are stored for this domain.
 */
function loadSiteRules(domain: string): SiteAutofillRule | null {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM site_rules WHERE domain = ?').get(domain) as any;
    if (!row) return null;
    return {
      domain: row.domain,
      loginUrlPattern: row.login_url_pattern,
      usernameSelector: row.username_selector,
      passwordSelector: row.password_selector,
      submitSelector: row.submit_selector,
      successIndicatorSelector: row.success_indicator_selector,
    };
  } catch {
    return null;
  }
}

/**
 * Build CSS selector string for username fields.
 * Uses site-specific rules if available, otherwise falls back to defaults.
 */
function getUsernameSelectors(siteRule: SiteAutofillRule | null): string {
  if (siteRule?.usernameSelector) {
    return siteRule.usernameSelector;
  }

  // Default comprehensive selectors — ordered by specificity
  return [
    // Autocomplete attributes (most reliable)
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[autocomplete="login"]',
    'input[autocomplete="nickname"]',

    // Type-based
    'input[type="email"]',

    // Name attribute patterns (case-insensitive via CSS :where or [name*=])
    'input[type="text"][name*="user" i]',
    'input[type="text"][name*="email" i]',
    'input[type="text"][name*="login" i]',
    'input[type="text"][name*="account" i]',
    'input[type="text"][name*="log" i]',
    'input[type="text"][name*="signin" i]',

    // No-type inputs (default text)
    'input:not([type])[name*="user" i]',
    'input:not([type])[name*="email" i]',
    'input:not([type])[name*="login" i]',
    'input:not([type])[name*="log" i]',

    // id-based fallbacks
    '#username',
    '#user',
    '#email',
    '#login',
    '#signin-email',

    // Placeholder patterns
    'input[placeholder*="user" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="login" i]',
    'input[placeholder*="account" i]',
  ].join(',');
}

/**
 * Build CSS selector string for password fields.
 */
function getPasswordSelectors(siteRule: SiteAutofillRule | null): string {
  if (siteRule?.passwordSelector) {
    return siteRule.passwordSelector;
  }

  return [
    'input[type="password"]',
    'input[type="password"][autocomplete="current-password"]',
    'input[type="password"][autocomplete="new-password"]',
    'input[type="password"][name*="password" i]',
    'input[type="password"][name*="pass" i]',
    'input[type="password"][name*="pwd" i]',
    'input[type="password"][name*="secret" i]',
    '#password',
    '#pass',
    '#pwd',
    'input[placeholder*="password" i]',
    'input[placeholder*="pass" i]',
  ].join(',');
}

/**
 * Determine if the current page URL matches a login URL pattern.
 */
function urlMatchesLoginPattern(url: string, pattern: string | null): boolean {
  if (!pattern) return true; // no pattern = always try
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(url);
  } catch {
    return true; // malformed pattern = don't block
  }
}

/**
 * The autofill content script that gets injected into web pages.
 * This is the actual script that runs inside the webview's page context.
 *
 * Template placeholders:
 *   __AUTOFILL_USERNAME__  — JSON-stringified username/email value
 *   __AUTOFILL_PASSWORD__  — JSON-stringified password value
 *   __AUTOFILL_SUBMIT__    — CSS selector for submit button (empty string = no submit)
 */
export const AUTOFILL_CONTENT_SCRIPT = `
(function() {
  'use strict';

  const username = __AUTOFILL_USERNAME__;
  const password = __AUTOFILL_PASSWORD__;
  const submitSelector = __AUTOFILL_SUBMIT__;
  let filled = false;

  /**
   * Find username and password fields on the page.
   * Uses selectors passed from the main process (site-specific or defaults).
   */
  function findLoginFields() {
    // These selectors are injected by the main process based on site rules
    const usernameSelectors = __AUTOFILL_USERNAME_SELECTORS__;
    const passwordSelectors = __AUTOFILL_PASSWORD_SELECTORS__;

    // Try to find the most specific username field first
    const usernameCandidates = document.querySelectorAll(usernameSelectors);
    const passwordCandidates = document.querySelectorAll(passwordSelectors);

    // Filter out hidden/disabled fields
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      return el.offsetHeight > 0 && el.offsetWidth > 0 &&
             style.display !== 'none' && style.visibility !== 'hidden';
    };

    const usernameField = Array.from(usernameCandidates).find(el => visible(el)) || usernameCandidates[0] || null;
    const passwordField = Array.from(passwordCandidates).find(el => visible(el)) || passwordCandidates[0] || null;

    return { usernameField, passwordField };
  }

  /**
   * Trigger native DOM events for framework compatibility.
   * Uses the native value setter so React/Vue/Angular pick up the change.
   */
  function triggerNativeEvents(element, value) {
    if (!element) return;

    // Store the element's previously focused state
    const isFocused = document.activeElement === element;

    // Set the value property using the native setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      // Fallback: direct assignment
      element.value = value;
    }

    // Dispatch input event (React, Vue, Angular all listen for this)
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

    // Dispatch change event
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Dispatch blur/focus events if needed
    if (!isFocused) {
      element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  /**
   * Submit the form by clicking the submit button or pressing Enter.
   */
  function triggerSubmit() {
    if (!submitSelector || submitSelector === '') return;

    // Try matching the submit selector
    const submitBtn = document.querySelector(submitSelector);
    if (submitBtn) {
      submitBtn.click();
      console.log('[PVB Autofill] Submit button clicked via selector:', submitSelector);
      return;
    }

    // Fallback: find the closest form and submit it
    const passwordField = document.querySelector(passwordSelectors);
    if (passwordField) {
      const form = passwordField.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        console.log('[PVB Autofill] Form submitted via closest form element');
      }
    }
  }

  /**
   * Main autofill attempt.
   */
  function attemptAutofill() {
    if (filled) return;
    const { usernameField, passwordField } = findLoginFields();

    if (usernameField && passwordField) {
      triggerNativeEvents(usernameField, username);
      triggerNativeEvents(passwordField, password);

      // Brief visual feedback
      const flashColor = '#e8f5e9';
      usernameField.style.transition = 'background-color 0.3s';
      usernameField.style.backgroundColor = flashColor;
      passwordField.style.transition = 'background-color 0.3s';
      passwordField.style.backgroundColor = flashColor;

      setTimeout(() => {
        usernameField.style.backgroundColor = '';
        passwordField.style.backgroundColor = '';
      }, 1000);

      filled = true;
      console.log('[PVB Autofill] Credentials filled successfully');

      // Auto-submit if configured
      if (submitSelector && submitSelector !== '') {
        setTimeout(triggerSubmit, 300);
      }
    }
  }

  // Immediate attempt
  attemptAutofill();

  // Retry with delays (for slow-loading forms)
  setTimeout(attemptAutofill, 500);
  setTimeout(attemptAutofill, 1500);
  setTimeout(attemptAutofill, 3000);

  // Observe for dynamically loaded forms (SPA frameworks)
  const observer = new MutationObserver(() => {
    if (!filled) attemptAutofill();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Listen for postMessage-based retriggers
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'pvb-autofill') {
      attemptAutofill();
    }
  });
})();
`;

export class AutofillEngine {
  /**
   * Execute autofill on a specific tab/view.
   * @param view - The BrowserView containing the target web page
   * @param request - Autofill details including URL and credentials
   * @param autoSubmit - Whether to automatically submit the form (default: false)
   * @returns true if autofill was attempted (domain matched)
   */
  async autofill(
    view: BrowserView,
    request: {
      url: string;
      username: string;
      passwordSecretRef: string;
    },
    autoSubmit: boolean = false
  ): Promise<boolean> {
    const viewUrl = view.webContents.getURL();
    const safeUrl = request.url || viewUrl;

    // Validate hostname match — exact, not substring
    const currentHostname = extractHostname(viewUrl);
    const targetHostname = extractHostname(safeUrl);

    if (!currentHostname || !targetHostname) {
      console.warn('[Autofill] Could not extract hostname from URLs');
      return false;
    }

    if (!hostnameMatches(viewUrl, targetHostname)) {
      console.warn(
        `[Autofill] Hostname mismatch: page is "${currentHostname}", target is "${targetHostname}". Refusing to autofill.`
      );
      return false;
    }

    // Get the password from secure storage
    const password = await getCredential(request.passwordSecretRef);
    if (!password) {
      console.error('[Autofill] Password not found in secure storage');
      return false;
    }

    // Load site-specific rules
    const domain = extractDomain(safeUrl);
    const siteRule = domain ? loadSiteRules(domain) : null;

    // Validate URL matches login pattern (if site rule specifies one)
    if (siteRule && !urlMatchesLoginPattern(safeUrl, siteRule.loginUrlPattern)) {
      console.log(`[Autofill] URL does not match login pattern for ${domain}, skipping autofill`);
      return false;
    }

    // Get selectors
    const usernameSelectors = getUsernameSelectors(siteRule);
    const passwordSelectors = getPasswordSelectors(siteRule);
    const submitSelector = autoSubmit && siteRule?.submitSelector ? siteRule.submitSelector : '';

    // Escape strings for safe injection into the content script
    const escapedUsername = JSON.stringify(request.username);
    const escapedPassword = JSON.stringify(password);
    const escapedUsernameSelectors = JSON.stringify(usernameSelectors);
    const escapedPasswordSelectors = JSON.stringify(passwordSelectors);
    const escapedSubmitSelector = JSON.stringify(submitSelector);

    // Build the content script with actual values
    let script = AUTOFILL_CONTENT_SCRIPT
      .replace('__AUTOFILL_USERNAME__', escapedUsername)
      .replace('__AUTOFILL_PASSWORD__', escapedPassword)
      .replace('__AUTOFILL_USERNAME_SELECTORS__', escapedUsernameSelectors)
      .replace('__AUTOFILL_PASSWORD_SELECTORS__', escapedPasswordSelectors)
      .replace('__AUTOFILL_SUBMIT__', escapedSubmitSelector);

    // Execute the script in the web page context
    try {
      await view.webContents.executeJavaScript(script);
      console.log(`[Autofill] Script injected for: ${targetHostname}`);
      return true;
    } catch (err) {
      console.error(`[Autofill] Failed to execute script:`, err);
      return false;
    }
  }
}

// Singleton
export const autofillEngine = new AutofillEngine();
