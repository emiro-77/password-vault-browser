// ============================================================================
// Error Page — self-contained HTML shown when a page fails to load
// ============================================================================
//
// Chromium fires `did-fail-load` on the main frame for network-level failures
// (DNS not resolved, connection refused/reset, timeouts, offline, SSL errors,
// aborted loads, etc.). Those failures would otherwise leave the tab showing a
// blank/previous page with no explanation. We render our own branded error
// page instead so the user gets a clear message + a Retry button.
//
// HTTP status errors (404/503/500/…) are ALSO surfaced here when the server
// returns no usable body — see mapHttpStatus() — but when a site serves its
// own 404/503 page we leave that intact (the browser shows the real content).

/** A friendly {title, message} pair for a Chromium network error code. */
interface ErrorInfo {
  title: string;
  message: string;
  hint?: string;
}

/**
 * Map a Chromium `errorCode` (from did-fail-load) to a friendly message.
 * Codes: https://source.chromium.org/chromium/chromium/src/+/main:net/base/net_error_list.h
 */
export function describeNetError(errorCode: number, errorDescription: string): ErrorInfo {
  switch (errorCode) {
    case -105: // NAME_NOT_RESOLVED
      return {
        title: 'This site can’t be reached',
        message: 'The server’s DNS address could not be found.',
        hint: 'Check the address for typos, or confirm you’re connected to the internet.',
      };
    case -106: // INTERNET_DISCONNECTED
      return {
        title: 'No internet connection',
        message: 'You appear to be offline.',
        hint: 'Check your Wi-Fi or network cable and try again.',
      };
    case -109: // ADDRESS_UNREACHABLE
      return {
        title: 'This site can’t be reached',
        message: 'The server’s IP address is unreachable.',
        hint: 'The site may be down, or your network may be blocking it.',
      };
    case -102: // CONNECTION_REFUSED
      return {
        title: 'This site can’t be reached',
        message: 'The server refused the connection.',
        hint: 'The site may be down or not accepting connections on this port.',
      };
    case -101: // CONNECTION_RESET
      return {
        title: 'Connection was reset',
        message: 'The connection to the server was interrupted.',
        hint: 'Try reloading the page.',
      };
    case -118: // CONNECTION_TIMED_OUT
    case -7: // TIMED_OUT
      return {
        title: 'This site took too long to respond',
        message: 'The connection timed out.',
        hint: 'The server may be busy or your connection may be slow. Try again.',
      };
    case -137: // NAME_RESOLUTION_FAILED
      return {
        title: 'This site can’t be reached',
        message: 'The site’s hostname could not be resolved.',
        hint: 'Check the address and your internet connection.',
      };
    case -201: // CERT_DATE_INVALID
    case -200: // CERT_COMMON_NAME_INVALID
    case -202: // CERT_AUTHORITY_INVALID
      return {
        title: 'Your connection is not private',
        message: 'The site’s security certificate is not trusted.',
        hint: 'This can happen if the certificate is expired, self-signed, or the clock is wrong.',
      };
    case -3: // ABORTED — navigation was cancelled (often benign)
      return {
        title: 'Page load stopped',
        message: 'The navigation was cancelled before it finished.',
        hint: 'Try reloading the page.',
      };
    case -2: // FAILED (generic)
    default:
      return {
        title: 'This page didn’t load',
        message: errorDescription || 'An unknown network error occurred.',
        hint: 'Check the address and your internet connection, then try again.',
      };
  }
}

/**
 * Map an HTTP status code to a friendly message. Used only when a server-error
 * response has no meaningful body of its own.
 */
export function mapHttpStatus(status: number): ErrorInfo {
  switch (status) {
    case 400:
      return { title: '400 — Bad Request', message: 'The server couldn’t understand the request.' };
    case 401:
      return { title: '401 — Unauthorized', message: 'You need to sign in to view this page.' };
    case 403:
      return { title: '403 — Forbidden', message: 'You don’t have permission to access this page.' };
    case 404:
      return { title: '404 — Page not found', message: 'The page you requested doesn’t exist on this server.' };
    case 408:
      return { title: '408 — Request Timeout', message: 'The server timed out waiting for the request.' };
    case 429:
      return { title: '429 — Too Many Requests', message: 'You’ve sent too many requests. Please slow down.' };
    case 500:
      return { title: '500 — Internal Server Error', message: 'The server encountered an unexpected error.' };
    case 502:
      return { title: '502 — Bad Gateway', message: 'The server got an invalid response from upstream.' };
    case 503:
      return { title: '503 — Service Unavailable', message: 'The server is temporarily unable to handle the request.' };
    case 504:
      return { title: '504 — Gateway Timeout', message: 'The upstream server took too long to respond.' };
    default:
      return {
        title: `${status} — Server error`,
        message: 'The server returned an error response.',
      };
  }
}

/** Escape a string for safe interpolation into HTML text/attributes. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a full, self-contained HTML document for an error page. Themed to match
 * the browser shell. Includes a Retry button (reloads `failedUrl`) and a
 * technical detail line. No external assets — safe to load as a data: URL.
 */
export function renderErrorPage(opts: {
  title: string;
  message: string;
  hint?: string;
  code?: string;
  failedUrl: string;
}): string {
  const { title, message, hint, code, failedUrl } = opts;
  const safeUrl = esc(failedUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #1e1e2e; color: #cdd6f4;
    padding: 24px;
  }
  .card {
    max-width: 560px; width: 100%;
    background: #181825; border: 1px solid #313244; border-radius: 14px;
    padding: 40px 36px; text-align: center;
    box-shadow: 0 12px 40px rgba(0,0,0,0.35);
  }
  .icon { font-size: 52px; line-height: 1; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0 0 10px; color: #f5f5f7; font-weight: 650; }
  p.message { font-size: 15px; margin: 0 0 8px; color: #bac2de; }
  p.hint { font-size: 13px; margin: 0 0 24px; color: #9399b2; }
  .url {
    display: inline-block; max-width: 100%; overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #89b4fa;
    background: #11111b; border: 1px solid #313244; border-radius: 8px;
    padding: 8px 12px; margin-bottom: 24px;
  }
  .actions { display: flex; gap: 12px; justify-content: center; }
  button {
    font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
    border: none; border-radius: 9px; padding: 11px 22px; transition: filter .15s ease;
  }
  button:hover { filter: brightness(1.1); }
  .retry { background: #89b4fa; color: #11111b; }
  .code { margin-top: 22px; font-size: 11px; color: #6c7086; letter-spacing: .3px; }
</style>
</head>
<body>
  <main class="card" role="alert">
    <div class="icon" aria-hidden="true">🚫</div>
    <h1>${esc(title)}</h1>
    <p class="message">${esc(message)}</p>
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
    <div class="url" title="${safeUrl}">${safeUrl}</div>
    <div class="actions">
      <button class="retry" onclick="location.href='${safeUrl}'">Try again</button>
    </div>
    ${code ? `<div class="code">${esc(code)}</div>` : ''}
  </main>
</body>
</html>`;
}

/** Convenience: build a data: URL for the error page (loadable via loadURL). */
export function errorPageDataUrl(html: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}
