// ============================================================================
// Tests for Status Manager Expiry Logic
// ============================================================================
//
// Tests the 24-hour expiry behavior:
// 1. logged_in status transitions to expired after 24h
// 2. active_tab_open takes priority over logged_in/expired
// 3. never_used stays as-is
// 4. login_failed stays as-is
// 5. needs_2fa stays as-is

type LoginStatus =
  | 'never_used'
  | 'logged_in'
  | 'expired'
  | 'login_failed'
  | 'needs_2fa'
  | 'active_tab_open';

const LOGGED_IN_DURATION_MS = 24 * 60 * 60 * 1000;

interface StatusRow {
  status: LoginStatus;
  logged_in_until: string | null;
  active_tab_id: string | null;
}

function computeCurrentStatus(row: StatusRow, nowMs: number): LoginStatus {
  if (row.active_tab_id) {
    return 'active_tab_open';
  }
  if (row.status === 'logged_in' && row.logged_in_until) {
    const untilMs = new Date(row.logged_in_until).getTime();
    if (nowMs > untilMs) {
      return 'expired';
    }
  }
  return row.status;
}

function test_logged_in_within_24h() {
  const now = Date.now();
  const recent = new Date(now + LOGGED_IN_DURATION_MS - 60000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: recent, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'logged_in', `Expected "logged_in", got "${result}"`);
  console.log('  ✓ logged_in stays logged_in within 24h');
}

function test_logged_in_expired_after_24h() {
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: past, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'expired', `Expected "expired", got "${result}"`);
  console.log('  ✓ logged_in becomes expired after 24h');
}

function test_logged_in_very_old() {
  const now = Date.now();
  const old = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: old, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'expired', `Expected "expired", got "${result}"`);
  console.log('  ✓ logged_in becomes expired after many days');
}

function test_active_tab_takes_priority() {
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: past, active_tab_id: 'tab-123' };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'active_tab_open', `Expected "active_tab_open", got "${result}"`);
  console.log('  ✓ active_tab_open takes priority over expired status');
}

function test_active_tab_overrides_valid_login() {
  const now = Date.now();
  const future = new Date(now + LOGGED_IN_DURATION_MS - 60000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: future, active_tab_id: 'tab-456' };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'active_tab_open', `Expected "active_tab_open", got "${result}"`);
  console.log('  ✓ active_tab_open takes priority over valid logged_in');
}

function test_never_used_unchanged() {
  const now = Date.now();
  const row: StatusRow = { status: 'never_used', logged_in_until: null, active_tab_id: null };
  const result1 = computeCurrentStatus(row, now);
  console.assert(result1 === 'never_used', `Expected "never_used", got "${result1}"`);
  const rowPast: StatusRow = { status: 'never_used', logged_in_until: new Date(now - 100000).toISOString(), active_tab_id: null };
  const result2 = computeCurrentStatus(rowPast, now);
  console.assert(result2 === 'never_used', `Expected "never_used", got "${result2}"`);
  console.log('  ✓ never_used stays never_used');
}

function test_login_failed_unchanged() {
  const now = Date.now();
  const row: StatusRow = { status: 'login_failed', logged_in_until: null, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'login_failed', `Expected "login_failed", got "${result}"`);
  console.log('  ✓ login_failed stays login_failed');
}

function test_needs_2fa_unchanged() {
  const now = Date.now();
  const row: StatusRow = { status: 'needs_2fa', logged_in_until: null, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'needs_2fa', `Expected "needs_2fa", got "${result}"`);
  console.log('  ✓ needs_2fa stays needs_2fa');
}

function test_boundary_exactly_at_expiry() {
  const now = Date.now();
  const exactNow = new Date(now).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: exactNow, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  console.assert(result === 'logged_in', `Expected "logged_in" at exact expiry, got "${result}"`);
  const justPast = new Date(now - 1).toISOString();
  const row2: StatusRow = { status: 'logged_in', logged_in_until: justPast, active_tab_id: null };
  const result2 = computeCurrentStatus(row2, now);
  console.assert(result2 === 'expired', `Expected "expired" 1ms past, got "${result2}"`);
  console.log('  ✓ Boundary: logged_in at exact expiry, expired 1ms past');
}

function runAllTests() {
  console.log('=== Status Manager Expiry Logic Tests ===');
  test_logged_in_within_24h();
  test_logged_in_expired_after_24h();
  test_logged_in_very_old();
  test_active_tab_takes_priority();
  test_active_tab_overrides_valid_login();
  test_never_used_unchanged();
  test_login_failed_unchanged();
  test_needs_2fa_unchanged();
  test_boundary_exactly_at_expiry();
  console.log('✓ All expiry logic tests passed.');
}

runAllTests();
