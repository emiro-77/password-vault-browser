// ============================================================================
// Tests for Domain Utilities
// ============================================================================
//
// Tests:
// 1. extractHostname() — extracts normalized hostname, strips www, rejects non-http
// 2. extractDomain() — extracts eTLD+1, handles 2-part TLDs
// 3. sameDomain() — exact domain comparison
// 4. hostnameMatches() — exact hostname match, no substring
// 5. isValidUrl() — only http/https are valid
// 6. normalizeUrlOrSearch() — adds protocol, defaults to google search

import {
  extractHostname,
  extractDomain,
  sameDomain,
  hostnameMatches,
  isValidUrl,
  normalizeUrlOrSearch,
  belongsToMainSite,
  normalizeRoot,
  matchesRoot,
  belongsToRelated,
} from '../src/main/services/domain-utils';

// ============================================================================
// extractHostname
// ============================================================================

function test_extractHostname() {
  console.log('=== extractHostname ===');

  // Basic URL
  const r1 = extractHostname('https://www.example.com/page');
  console.assert(r1 === 'example.com', `Expected "example.com", got "${r1}"`);
  console.log('  ✓ Strips www prefix');

  const r2 = extractHostname('https://example.com');
  console.assert(r2 === 'example.com', `Expected "example.com", got "${r2}"`);
  console.log('  ✓ Simple hostname');

  const r3 = extractHostname('https://sub.domain.co.uk/path');
  console.assert(r3 === 'sub.domain.co.uk', `Expected "sub.domain.co.uk", got "${r3}"`);
  console.log('  ✓ Subdomain not stripped');

  // Non-http protocol
  const r4 = extractHostname('file:///C:/Users/test');
  console.assert(r4 === null, `Expected null, got "${r4}"`);
  console.log('  ✓ Rejects file:// protocol');

  const r5 = extractHostname('ftp://ftp.example.com');
  console.assert(r5 === null, `Expected null, got "${r5}"`);
  console.log('  ✓ Rejects ftp:// protocol');

  // Invalid URL
  const r6 = extractHostname('not a url');
  console.assert(r6 === null, `Expected null, got "${r6}"`);
  console.log('  ✓ Returns null for invalid URL');

  // Already without www
  const r7 = extractHostname('https://github.com/user/repo');
  console.assert(r7 === 'github.com', `Expected "github.com", got "${r7}"`);
  console.log('  ✓ Works without www');

  console.log('  ✓ All extractHostname tests passed');
}

// ============================================================================
// extractDomain
// ============================================================================

function test_extractDomain() {
  console.log('\n=== extractDomain ===');

  // Simple domain
  const r1 = extractDomain('https://www.example.com/page');
  console.assert(r1 === 'example.com', `Expected "example.com", got "${r1}"`);
  console.log('  ✓ Simple domain extraction');

  // Subdomain — should return eTLD+1
  const r2 = extractDomain('https://mail.google.com');
  console.assert(r2 === 'google.com', `Expected "google.com", got "${r2}"`);
  console.log('  ✓ Subdomain reduces to eTLD+1');

  // Two-part TLD (co.uk)
  const r3 = extractDomain('https://www.example.co.uk/page');
  console.assert(r3 === 'example.co.uk', `Expected "example.co.uk", got "${r3}"`);
  console.log('  ✓ Handles 2-part TLD (co.uk)');

  // Two-part TLD (com.au)
  const r4 = extractDomain('https://sub.example.com.au/path');
  console.assert(r4 === 'example.com.au', `Expected "example.com.au", got "${r4}"`);
  console.log('  ✓ Handles 2-part TLD (com.au)');

  // Non-http protocol
  const r5 = extractDomain('file:///C:/test');
  console.assert(r5 === null, `Expected null, got "${r5}"`);
  console.log('  ✓ Rejects non-http protocols');

  // IP address
  const r6 = extractDomain('https://127.0.0.1:3000/login');
  console.assert(r6 !== null, 'Expected a value for IP address');
  console.log('  ✓ Handles IP addresses (returns hostname)');

  // Invalid
  const r7 = extractDomain('');
  console.assert(r7 === null, `Expected null, got "${r7}"`);
  console.log('  ✓ Returns null for empty string');

  console.log('  ✓ All extractDomain tests passed');
}

// ============================================================================
// hostnameMatches
// ============================================================================

function test_hostnameMatches() {
  console.log('\n=== hostnameMatches ===');

  // Exact match
  const r1 = hostnameMatches('https://example.com/login', 'example.com');
  console.assert(r1 === true, `Expected true, got ${r1}`);
  console.log('  ✓ Exact match works');

  // With www (should still match)
  const r2 = hostnameMatches('https://www.example.com/page', 'example.com');
  console.assert(r2 === true, `Expected true, got ${r2}`);
  console.log('  ✓ www is stripped from both sides');

  // Subdomain does NOT match (exact hostname, not domain-level)
  const r3 = hostnameMatches('https://sub.example.com/page', 'example.com');
  console.assert(r3 === false, `Expected false, got ${r3}`);
  console.log('  ✓ Subdomain does not match exact hostname');

  // Different domain
  const r4 = hostnameMatches('https://other.com', 'example.com');
  console.assert(r4 === false, `Expected false, got ${r4}`);
  console.log('  ✓ Different domains do not match');

  // Naive substring check (security test)
  // "notexample.com" should NOT match "example.com"
  const r5 = hostnameMatches('https://notexample.com/login', 'example.com');
  console.assert(r5 === false, `Expected false (no substring match), got ${r5}`);
  console.log('  ✓ No substring match (security: "notexample.com" != "example.com")');

  // Another substring test
  const r6 = hostnameMatches('https://maliciousexample.com/phish', 'example.com');
  console.assert(r6 === false, `Expected false (no substring), got ${r6}`);
  console.log('  ✓ No substring match ("maliciousexample.com" != "example.com")');

  // Invalid URL
  const r7 = hostnameMatches('not a url', 'example.com');
  console.assert(r7 === false, `Expected false for invalid URL, got ${r7}`);
  console.log('  ✓ Returns false for invalid URL');

  console.log('  ✓ All hostnameMatches tests passed');
}

// ============================================================================
// sameDomain
// ============================================================================

function test_sameDomain() {
  console.log('\n=== sameDomain ===');

  const r1 = sameDomain('https://example.com/page1', 'https://example.com/page2');
  console.assert(r1 === true, `Expected true, got ${r1}`);
  console.log('  ✓ Same domain different paths');

  const r2 = sameDomain('https://www.example.com', 'https://example.com');
  console.assert(r2 === true, `Expected true, got ${r2}`);
  console.log('  ✓ www stripped for comparison');

  const r3 = sameDomain('https://example.com', 'https://other.com');
  console.assert(r3 === false, `Expected false, got ${r3}`);
  console.log('  ✓ Different domains');

  const r4 = sameDomain('https://example.com', 'https://sub.example.com');
  console.assert(r4 === true, `Expected true (subdomain of same domain), got ${r4}`);
  console.log('  ✓ Subdomain matches parent domain');

  console.log('  ✓ All sameDomain tests passed');
}

// ============================================================================
// isValidUrl
// ============================================================================

function test_isValidUrl() {
  console.log('\n=== isValidUrl ===');

  console.assert(isValidUrl('https://example.com') === true, 'https URL should be valid');
  console.assert(isValidUrl('http://example.com') === true, 'http URL should be valid');
  console.assert(isValidUrl('file:///C:/test') === false, 'file URL should be invalid');
  console.assert(isValidUrl('ftp://example.com') === false, 'ftp URL should be invalid');
  console.assert(isValidUrl('not a url') === false, 'Invalid string should be false');
  console.assert(isValidUrl('') === false, 'Empty string should be false');

  console.log('  ✓ All isValidUrl tests passed');
}

// ============================================================================
// normalizeUrlOrSearch
// ============================================================================

function test_normalizeUrlOrSearch() {
  console.log('\n=== normalizeUrlOrSearch ===');

  const r1 = normalizeUrlOrSearch('https://example.com');
  console.assert(r1 === 'https://example.com', `Expected unchanged URL, got "${r1}"`);
  console.log('  ✓ Keeps valid https URL unchanged');

  const r2 = normalizeUrlOrSearch('example.com');
  console.assert(r2 === 'https://example.com', `Expected "https://example.com", got "${r2}"`);
  console.log('  ✓ Adds https:// to bare domain');

  const r3 = normalizeUrlOrSearch('search query here');
  console.assert(r3.startsWith('https://www.google.com/search?q='), `Expected google search URL, got "${r3}"`);
  console.log('  ✓ Falls back to Google search');

  console.log('  ✓ All normalizeUrlOrSearch tests passed');
}

// ============================================================================
// belongsToMainSite() — login page / main page / related pages grouping
// ============================================================================

function test_belongsToMainSite() {
  console.log('Testing belongsToMainSite()...');

  // Login subdomain belongs to the main site (eTLD+1 match).
  console.assert(
    belongsToMainSite('https://login.chatgpt.com/auth', 'chatgpt.com') === true,
    'login.chatgpt.com should belong to chatgpt.com'
  );
  // Main page and nested/related pages under it belong too.
  console.assert(
    belongsToMainSite('https://chatgpt.com/c/123', 'chatgpt.com') === true,
    'nested chatgpt.com path should belong to chatgpt.com'
  );
  console.assert(
    belongsToMainSite('https://www.chatgpt.com', 'chatgpt.com') === true,
    'www.chatgpt.com should belong to chatgpt.com'
  );
  // A user-entered main domain with www is normalized.
  console.assert(
    belongsToMainSite('https://chatgpt.com', 'www.chatgpt.com') === true,
    'main domain with www prefix should still match'
  );
  // Unrelated site does NOT belong.
  console.assert(
    belongsToMainSite('https://example.com', 'chatgpt.com') === false,
    'example.com must NOT belong to chatgpt.com'
  );
  // Non-http is rejected.
  console.assert(
    belongsToMainSite('ftp://chatgpt.com', 'chatgpt.com') === false,
    'non-http URL must not match'
  );

  console.log('  ✓ All belongsToMainSite tests passed');
}

// ============================================================================
// normalizeRoot() — canonical host/path form for related-URL matching
// ============================================================================

function test_normalizeRoot() {
  console.log('Testing normalizeRoot()...');

  // Host is lowercased & www-stripped; PATH case is preserved (HTTP paths are
  // case-sensitive) and the trailing slash is trimmed.
  console.assert(
    normalizeRoot('https://www.Example.com/Dashboard/') === 'example.com/Dashboard',
    'full URL should normalize host, preserve path case, strip www, trim slash'
  );
  console.assert(
    normalizeRoot('example.com') === 'example.com',
    'bare host stays as-is'
  );
  console.assert(
    normalizeRoot('example.com/app?x=1#y') === 'example.com/app',
    'query and hash are dropped'
  );
  console.assert(
    normalizeRoot('  https://EXAMPLE.com  ') === 'example.com',
    'trims whitespace and lowercases host'
  );
  console.assert(normalizeRoot('') === '', 'empty stays empty');

  console.log('  ✓ All normalizeRoot tests passed');
}

// ============================================================================
// matchesRoot() / belongsToRelated() — related-URL path-prefix matching
// ============================================================================

function test_matchesRoot() {
  console.log('Testing matchesRoot() / belongsToRelated()...');

  // Path root matches itself and nested pages under it (whole-segment).
  console.assert(
    matchesRoot('https://example.com/dashboard/x', 'example.com/dashboard') === true,
    'nested page under related root should match'
  );
  console.assert(
    matchesRoot('https://example.com/dashboard', 'example.com/dashboard') === true,
    'exact related root should match'
  );
  // Guard against partial-segment false positives.
  console.assert(
    matchesRoot('https://example.com/dash', 'example.com/dashboard') === false,
    '/dash must NOT match /dashboard'
  );
  console.assert(
    matchesRoot('https://example.com/dashboardish', 'example.com/dashboard') === false,
    '/dashboardish must NOT match /dashboard (segment boundary)'
  );
  // Host-only root matches any path on that host.
  console.assert(
    matchesRoot('https://example.com/anything', 'example.com') === true,
    'host-only root matches any path'
  );
  // Different host never matches.
  console.assert(
    matchesRoot('https://other.com/dashboard', 'example.com/dashboard') === false,
    'different host must not match'
  );
  // www normalization on both sides.
  console.assert(
    matchesRoot('https://www.example.com/app', 'example.com/app') === true,
    'www is normalized before matching'
  );

  // belongsToRelated: matches if ANY root matches.
  console.assert(
    belongsToRelated('https://example.com/team/42', ['example.com/dashboard', 'example.com/team']) === true,
    'belongsToRelated should match when one root matches'
  );
  console.assert(
    belongsToRelated('https://example.com/other', ['example.com/dashboard', 'example.com/team']) === false,
    'belongsToRelated should be false when no root matches'
  );
  console.assert(
    belongsToRelated('https://example.com/x', []) === false,
    'belongsToRelated with no roots is false'
  );

  console.log('  ✓ All matchesRoot / belongsToRelated tests passed');
}

// ============================================================================
// Run all tests
// ============================================================================

function runAllTests() {
  test_extractHostname();
  test_extractDomain();
  test_hostnameMatches();
  test_sameDomain();
  test_isValidUrl();
  test_normalizeUrlOrSearch();
  test_belongsToMainSite();
  test_normalizeRoot();
  test_matchesRoot();
  console.log('\n✓ All domain-utils tests completed.');
}

runAllTests();
