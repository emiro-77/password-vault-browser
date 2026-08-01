// ============================================================================
// Error-page test — friendly messages + safe HTML rendering
// ============================================================================

import {
  describeNetError,
  mapHttpStatus,
  renderErrorPage,
  errorPageDataUrl,
  describeCertError,
  renderCertErrorPage,
  CERT_PROCEED_SENTINEL,
  CERT_BACK_SENTINEL,
} from '../src/main/services/error-page';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  ❌ assertion failed:', msg); }
  else console.log('  ✓', msg);
}

function test_describeNetError() {
  console.log('\n[error-page] describeNetError:');
  assert(/reached/i.test(describeNetError(-105, 'ERR_NAME_NOT_RESOLVED').title), 'DNS (-105) -> "can’t be reached"');
  assert(/offline|internet/i.test(describeNetError(-106, '').title + describeNetError(-106, '').message), 'offline (-106) mentions internet');
  assert(/refused/i.test(describeNetError(-102, '').message), 'refused (-102)');
  assert(/timed out|too long/i.test(describeNetError(-118, '').title + describeNetError(-118, '').message), 'timeout (-118)');
  assert(/private|certificate/i.test(describeNetError(-201, '').title + describeNetError(-201, '').message), 'cert error (-201)');
  // Unknown code falls through to a generic message that echoes the description.
  const generic = describeNetError(-99999, 'ERR_WEIRD');
  assert(generic.title.length > 0 && generic.message.length > 0, 'unknown code -> generic non-empty message');
}

function test_mapHttpStatus() {
  console.log('\n[error-page] mapHttpStatus:');
  assert(/404/.test(mapHttpStatus(404).title) && /exist|not found/i.test(mapHttpStatus(404).message), '404 mapped');
  assert(/503/.test(mapHttpStatus(503).title), '503 mapped');
  assert(/500/.test(mapHttpStatus(500).title), '500 mapped');
  assert(/403/.test(mapHttpStatus(403).title), '403 mapped');
  assert(/Server error/i.test(mapHttpStatus(599).title), 'unknown 5xx -> generic server error');
}

function test_renderErrorPage_escaping() {
  console.log('\n[error-page] renderErrorPage HTML escaping:');
  const html = renderErrorPage({
    title: 'Boom <script>',
    message: 'a & b "c"',
    failedUrl: 'https://evil.example.com/?x=<script>alert(1)</script>',
  });
  assert(html.includes('<!DOCTYPE html>'), 'is a full HTML document');
  assert(!html.includes('<script>alert(1)</script>'), 'raw <script> from URL is NOT present unescaped');
  assert(html.includes('&lt;script&gt;'), 'dangerous chars are escaped');
  assert(html.includes('Try again'), 'has a Try again button');
  // The retry button navigates to the escaped URL.
  assert(html.includes("location.href='https://evil.example.com/?x=&lt;script&gt;"), 'retry uses escaped URL');
}

function test_dataUrl() {
  console.log('\n[error-page] errorPageDataUrl:');
  const url = errorPageDataUrl('<html></html>');
  assert(url.startsWith('data:text/html;charset=utf-8,'), 'produces a data: URL');
  assert(url.includes('%3Chtml%3E'), 'content is URL-encoded');
}

function test_describeCertError() {
  console.log('\n[error-page] describeCertError:');
  assert(describeCertError('net::ERR_CERT_AUTHORITY_INVALID').label === 'ERR_CERT_AUTHORITY_INVALID', 'authority-invalid label');
  assert(/authority|trust/i.test(describeCertError('net::ERR_CERT_AUTHORITY_INVALID').detail), 'authority-invalid explains trust');
  assert(/expired|not yet valid|clock/i.test(describeCertError('net::ERR_CERT_DATE_INVALID').detail), 'date-invalid explains expiry');
  assert(describeCertError('net::ERR_SOMETHING_NEW').detail.length > 0, 'unknown cert error -> generic detail');
}

function test_renderCertErrorPage() {
  console.log('\n[error-page] renderCertErrorPage:');
  const html = renderCertErrorPage({
    failedUrl: 'https://self-signed.example.com/login?x=<script>alert(1)</script>',
    certError: 'net::ERR_CERT_AUTHORITY_INVALID',
  });
  assert(html.includes('<!DOCTYPE html>'), 'is a full HTML document');
  assert(/Your connection is not private/i.test(html), 'has the "not private" headline');
  assert(html.includes('self-signed.example.com'), 'shows the host');
  assert(html.includes('ERR_CERT_AUTHORITY_INVALID'), 'shows the error code');
  assert(!html.includes('<script>alert(1)</script>'), 'URL script is not present unescaped');
  assert(html.includes('Back to safety'), 'has Back to safety button');
  assert(html.includes('Advanced'), 'has Advanced button');
  assert(/Proceed to .*\(unsafe\)/i.test(html), 'has a Proceed (unsafe) option');
  assert(html.includes(CERT_PROCEED_SENTINEL), 'Proceed links to the proceed sentinel');
  assert(html.includes(CERT_BACK_SENTINEL), 'Back links to the back sentinel');
}

test_describeNetError();
test_mapHttpStatus();
test_renderErrorPage_escaping();
test_dataUrl();
test_describeCertError();
test_renderCertErrorPage();

if (failures > 0) { console.error(`\n[error-page] ${failures} assertion(s) failed`); process.exit(1); }
else console.log('\n[error-page] all assertions passed');
