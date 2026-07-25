// ============================================================================
// Domain Utilities — safe hostname extraction and matching
// ============================================================================
// All domain operations use exact matching — never naive substring matching.

/**
 * Extract the hostname from a URL string.
 * Returns null for invalid or malformed URLs.
 * Strips 'www.' prefix for consistent matching.
 */
export function extractHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Only http/https are valid browser protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // Remove 'www.' prefix for normalized matching
    const normalized = hostname.replace(/^www\./, '');
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Extract the fully-qualified domain (eTLD+1) from a URL.
 * Uses the public suffix list concept for proper domain extraction.
 * Falls back to hostname if no public suffix match is found.
 *
 * Examples:
 *   https://www.example.com/page   -> example.com
 *   https://sub.example.co.uk       -> example.co.uk
 *   https://github.com              -> github.com
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const normalized = hostname.replace(/^www\./, '');

    // Split into parts for domain extraction
    const parts = normalized.split('.');

    // If we have at least 2 parts, return the last 2 as the domain
    // This is a simplified approach — for a full PSL-based solution,
    // we'd use a library like psl or tldts.
    if (parts.length >= 2) {
      // Handle common 2-part TLDs (co.uk, com.au, etc.)
      // For MVP, we use a simple heuristic: if the last part is <= 2 chars
      // (like .uk, .au, .jp) and we have at least 3 parts, take 3 parts.
      const lastPart = parts[parts.length - 1];
      if (lastPart.length <= 2 && parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    }

    return normalized;
  } catch {
    return null;
  }
}

/**
 * Check if two URLs share the same domain (eTLD+1).
 * Uses exact hostname matching — never substring.
 */
export function sameDomain(url1: string, url2: string): boolean {
  const domain1 = extractDomain(url1);
  const domain2 = extractDomain(url2);

  if (!domain1 || !domain2) return false;
  return domain1 === domain2;
}

/**
 * Check if a URL's hostname matches an expected hostname exactly.
 * Strips 'www.' from both sides before comparison.
 */
export function hostnameMatches(url: string, expectedHostname: string): boolean {
  const actualHostname = extractHostname(url);
  if (!actualHostname) return false;

  const normalizedExpected = expectedHostname.toLowerCase().replace(/^www\./, '');
  return actualHostname === normalizedExpected;
}

/**
 * Whether a URL belongs to a given "main website" — i.e. its eTLD+1 matches
 * `mainDomain`. This groups the login page (login.chatgpt.com), the main page
 * (chatgpt.com) and any nested/related page (chatgpt.com/settings) together,
 * because they all share the same eTLD+1.
 *
 *   belongsToMainSite('https://login.chatgpt.com/auth', 'chatgpt.com') -> true
 *   belongsToMainSite('https://chatgpt.com/c/123', 'chatgpt.com')      -> true
 *   belongsToMainSite('https://example.com', 'chatgpt.com')            -> false
 */
export function belongsToMainSite(url: string, mainDomain: string): boolean {
  const d = extractDomain(url);
  if (!d) return false;
  const normalizedMain = mainDomain.toLowerCase().replace(/^www\./, '');
  return d === normalizedMain;
}

/**
 * Normalize a URL/host into a comparable "root" of the form `host/path`
 * (lowercase host with www stripped, no protocol, no query/hash, trailing
 * slash trimmed). Accepts bare hosts, hosts-with-path, or full URLs.
 *
 *   normalizeRoot('https://www.Example.com/Dashboard/')  -> 'example.com/dashboard'
 *   normalizeRoot('example.com')                          -> 'example.com'
 *   normalizeRoot('example.com/app?x=1#y')                -> 'example.com/app'
 */
export function normalizeRoot(input: string): string {
  let s = (input || '').trim();
  if (!s) return '';
  // Strip protocol if present.
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  // Drop query/hash.
  s = s.split('#')[0].split('?')[0];
  // Split host from path.
  const slash = s.indexOf('/');
  let host = slash === -1 ? s : s.slice(0, slash);
  let pathPart = slash === -1 ? '' : s.slice(slash);
  host = host.toLowerCase().replace(/^www\./, '');
  // Trim trailing slashes on the path; keep a leading slash form only if non-empty.
  pathPart = pathPart.replace(/\/+$/, '');
  return pathPart ? `${host}${pathPart}` : host;
}

/**
 * Whether a full URL falls under a given related-URL "root". A root is any
 * `host` or `host/path` string; the URL matches when its own normalized root
 * starts at that host and its path is at or below the root's path.
 *
 *   matchesRoot('https://example.com/dashboard/x', 'example.com/dashboard') -> true
 *   matchesRoot('https://example.com/dash', 'example.com/dashboard')        -> false (not a path segment)
 *   matchesRoot('https://example.com/anything', 'example.com')              -> true
 */
export function matchesRoot(url: string, root: string): boolean {
  const rootNorm = normalizeRoot(root);
  if (!rootNorm) return false;

  // Build the URL's normalized root, but preserve enough path to compare.
  const hostname = extractHostname(url);
  if (!hostname) return false;

  let urlPath = '';
  try {
    urlPath = new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
  const urlRoot = urlPath ? `${hostname}${urlPath}` : hostname;

  // Split root into host + path.
  const rSlash = rootNorm.indexOf('/');
  const rHost = rSlash === -1 ? rootNorm : rootNorm.slice(0, rSlash);
  const rPath = rSlash === -1 ? '' : rootNorm.slice(rSlash);

  if (hostname !== rHost) return false;
  if (!rPath) return true; // host-only root matches any path on that host

  // Path-prefix match on whole segments: '/dashboard' matches '/dashboard' and
  // '/dashboard/x' but NOT '/dashboardish'.
  return urlPath === rPath || urlPath.startsWith(rPath + '/');
}

/**
 * Whether a URL belongs to any of the given related roots (see matchesRoot).
 */
export function belongsToRelated(url: string, relatedRoots: string[]): boolean {
  if (!relatedRoots || relatedRoots.length === 0) return false;
  return relatedRoots.some(r => matchesRoot(url, r));
}

/**
 * Validate that a URL is a proper, navigable http/https URL.
 */
export function isValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * If the input doesn't look like a URL, treat it as a search query
 * and return a google search URL.
 */
export function normalizeUrlOrSearch(input: string): string {
  const trimmed = input.trim();

  // If it's already a valid URL, return it
  if (isValidUrl(trimmed)) {
    return trimmed;
  }

  // If it starts with http:// or https:// but is malformed, try fixing
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    }
  }

  // If it looks like a domain without protocol, add https://
  if (/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+/.test(trimmed)) {
    const withProtocol = `https://${trimmed}`;
    if (isValidUrl(withProtocol)) {
      return withProtocol;
    }
  }

  // Default: treat as search query
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
