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
