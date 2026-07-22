// ============================================================================
// Tests for shared URL / search normalization
// ============================================================================

import { normalizeUrlOrSearch, isValidUrl, domainFromUrl } from '../src/shared/url-utils';

let passed = 0;
let failed = 0;

function eq(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.error(`  \u2717 ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
    failed++;
  }
}

console.log('\n=== normalizeUrlOrSearch ===');
eq('keeps valid https URL', normalizeUrlOrSearch('https://example.com/path'), 'https://example.com/path');
eq('keeps valid http URL', normalizeUrlOrSearch('http://example.com'), 'http://example.com');
eq('adds https to bare domain', normalizeUrlOrSearch('example.com'), 'https://example.com');
eq('adds https to subdomain', normalizeUrlOrSearch('sub.example.co.uk'), 'https://sub.example.co.uk');
eq('localhost -> http', normalizeUrlOrSearch('localhost'), 'http://localhost');
eq('localhost:port -> http', normalizeUrlOrSearch('localhost:3000'), 'http://localhost:3000');
eq('free text -> search', normalizeUrlOrSearch('hello world'), 'https://duckduckgo.com/?q=hello%20world');
eq('single word -> search', normalizeUrlOrSearch('weather'), 'https://duckduckgo.com/?q=weather');
eq('empty -> about:blank', normalizeUrlOrSearch('   '), 'about:blank');

console.log('\n=== isValidUrl ===');
eq('valid https', isValidUrl('https://a.com'), true);
eq('invalid bare', isValidUrl('a.com'), false);
eq('rejects ftp', isValidUrl('ftp://a.com'), false);

console.log('\n=== domainFromUrl ===');
eq('strips www', domainFromUrl('https://www.example.com/x'), 'example.com');
eq('keeps subdomain', domainFromUrl('https://mail.google.com'), 'mail.google.com');
eq('null for garbage', domainFromUrl('not a url'), null);

if (failed > 0) {
  console.error(`\n\u2717 ${failed} url-utils test(s) failed.`);
  process.exit(1);
}
console.log(`\n\u2713 All ${passed} url-utils tests passed.`);
