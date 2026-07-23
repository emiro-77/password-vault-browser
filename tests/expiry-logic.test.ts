// ============================================================================
// Tests for Status Manager Expiry Logic
// ============================================================================
//
// Mirrors StatusManager.computeCurrentStatus (src/main/services/status-manager.ts).
// New status rules:
// 1. After the 24h window (logged_in_until) lapses, ANY non-neutral status
//    resets to "never_used" ("refresh to never used after 24 hours").
// 2. Within the window, a row that still holds an active tab is THE single
//    active account -> "active_tab_open".
// 3. A previously logged-in account that no longer holds the active tab has
//    been superseded -> "used" (shown red).
// 4. Terminal/neutral statuses (never_used, login_failed, needs_2fa) pass
//    through unchanged.

type LoginStatus =
  | 'never_used'
  | 'logged_in'
  | 'used'
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
  // 24h window check: once the window lapses, the account is "never_used".
  if (row.logged_in_until) {
    const untilMs = new Date(row.logged_in_until).getTime();
    if (nowMs > untilMs) {
      return 'never_used';
    }
  }
  // Within the window, a live active tab means THE active account.
  if (row.active_tab_id) {
    return 'active_tab_open';
  }
  // A previously logged-in account without the active tab -> "used" (red).
  if (row.status === 'logged_in' || row.status === 'active_tab_open') {
    return 'used';
  }
  return row.status;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { throw new Error('ASSERT FAILED: ' + msg); }
}

function test_active_within_24h() {
  const now = Date.now();
  const future = new Date(now + LOGGED_IN_DURATION_MS - 60000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: future, active_tab_id: 'tab-1' };
  const result = computeCurrentStatus(row, now);
  assert(result === 'active_tab_open', `Expected "active_tab_open", got "${result}"`);
  console.log('  ✓ active account (has tab, within 24h) -> active_tab_open');
}

function test_logged_in_without_tab_becomes_used() {
  const now = Date.now();
  const future = new Date(now + LOGGED_IN_DURATION_MS - 60000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: future, active_tab_id: null };
  const result = computeCurrentStatus(row, now);
  assert(result === 'used', `Expected "used", got "${result}"`);
  console.log('  ✓ superseded logged-in account (no tab, within 24h) -> used');
}

function test_resets_to_never_used_after_24h() {
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
  // Even a still-linked active tab resets after the window lapses.
  const rowActive: StatusRow = { status: 'active_tab_open', logged_in_until: past, active_tab_id: 'tab-2' };
  assert(computeCurrentStatus(rowActive, now) === 'never_used',
    'expired active account should reset to never_used');
  const rowUsed: StatusRow = { status: 'logged_in', logged_in_until: past, active_tab_id: null };
  assert(computeCurrentStatus(rowUsed, now) === 'never_used',
    'expired used account should reset to never_used');
  console.log('  ✓ after 24h everything refreshes to never_used');
}

function test_resets_after_many_days() {
  const now = Date.now();
  const old = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: old, active_tab_id: 'tab-x' };
  assert(computeCurrentStatus(row, now) === 'never_used', 'week-old login resets to never_used');
  console.log('  ✓ week-old login resets to never_used');
}

function test_never_used_unchanged() {
  const now = Date.now();
  const row: StatusRow = { status: 'never_used', logged_in_until: null, active_tab_id: null };
  assert(computeCurrentStatus(row, now) === 'never_used', 'never_used stays never_used');
  console.log('  ✓ never_used stays never_used');
}

function test_login_failed_unchanged() {
  const now = Date.now();
  const row: StatusRow = { status: 'login_failed', logged_in_until: null, active_tab_id: null };
  assert(computeCurrentStatus(row, now) === 'login_failed', 'login_failed stays login_failed');
  console.log('  ✓ login_failed stays login_failed');
}

function test_needs_2fa_unchanged() {
  const now = Date.now();
  const row: StatusRow = { status: 'needs_2fa', logged_in_until: null, active_tab_id: null };
  assert(computeCurrentStatus(row, now) === 'needs_2fa', 'needs_2fa stays needs_2fa');
  console.log('  ✓ needs_2fa stays needs_2fa');
}

function test_boundary_at_expiry() {
  const now = Date.now();
  // Exactly at expiry (not past): still within window -> active.
  const exact = new Date(now).toISOString();
  const row: StatusRow = { status: 'logged_in', logged_in_until: exact, active_tab_id: 'tab-b' };
  assert(computeCurrentStatus(row, now) === 'active_tab_open',
    'at exact expiry the account is still active');
  // 1ms past -> reset.
  const justPast = new Date(now - 1).toISOString();
  const row2: StatusRow = { status: 'logged_in', logged_in_until: justPast, active_tab_id: 'tab-b' };
  assert(computeCurrentStatus(row2, now) === 'never_used',
    '1ms past expiry resets to never_used');
  console.log('  ✓ boundary: active at exact expiry, never_used 1ms past');
}

function runAllTests() {
  console.log('=== Status Manager Expiry Logic Tests ===');
  test_active_within_24h();
  test_logged_in_without_tab_becomes_used();
  test_resets_to_never_used_after_24h();
  test_resets_after_many_days();
  test_never_used_unchanged();
  test_login_failed_unchanged();
  test_needs_2fa_unchanged();
  test_boundary_at_expiry();
  console.log('✓ All expiry logic tests passed.');
}

runAllTests();
