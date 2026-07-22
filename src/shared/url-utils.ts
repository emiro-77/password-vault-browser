// ============================================================================
// Shared URL / search normalization
// ============================================================================
// Usable from both the renderer and main process. Turns raw address-bar input
// into a navigable URL: keeps valid URLs, prepends https:// to bare domains,
// and falls back to a search query for everything else.

export function isValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const DOMAIN_RE = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+/;

/**
 * Normalize raw address-bar input into a navigable URL.
 * - valid http(s) URL           -> unchanged
 * - bare domain (example.com)   -> https://example.com
 * - localhost / localhost:PORT  -> http://localhost[:PORT]
 * - anything else               -> DuckDuckGo search
 */
export function normalizeUrlOrSearch(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';

  if (isValidUrl(trimmed)) return trimmed;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      return searchUrl(trimmed);
    }
  }

  // localhost with optional port/path
  if (/^localhost(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`;
  }

  if (DOMAIN_RE.test(trimmed) && !trimmed.includes(' ')) {
    const withProtocol = `https://${trimmed}`;
    if (isValidUrl(withProtocol)) return withProtocol;
  }

  return searchUrl(trimmed);
}

export function searchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

/**
 * Extract a normalized display domain (no www.) from a URL, or null.
 */
export function domainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}
