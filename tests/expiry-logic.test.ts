// ============================================================================
// Tests for Status Manager Expiry + Derived Active-Tab Logic
// ============================================================================
//
// Mirrors StatusManager.computeCurrentStatus (src/main/services/status-manager.ts).
//
// Status rules (derived-active model):
// 1. After the 24h window (logged_in_until) lapses, ANY non-neutral status
//    resets to "never_used" ("refresh to never used after 24 hours").
// 2. Within the window, "active" is DERIVED from the LIVE open tabs, not the
//    stored active_tab_id. An account is "active_tab_open" iff a live tab holds
//    its `${loginEntryId}::${domain}` key. This lets TWO tabs on the SAME
//    domain, each with a DIFFERENT account, both be active at once.
// 3. A previously logged-in account with NO live tab has been superseded ->
//    "used" (shown red), while still within the window.
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
  login_entry_id: string;
  domain: string;
  status: LoginStatus;
  logged_in_until: string | null;
  active_tab_id: string | null;
}

// Faithful mirror of StatusManager.computeCurrentStatus(row, nowMs, liveKeys).
function computeCurrentStatus(row: StatusRow, nowMs: number, liveKeys: Set<string>): LoginStatus {
  // 24h window check: once the window lapses, the account is "never_used".
  if (row.logged_in_until) {
    const untilMs = new Date(row.logged_in_until).getTime();
    if (nowMs > untilMs) {
      return 'never_used';
    }
  }
  // Active iff a LIVE open tab currently holds this exact account+domain.
  if (liveKeys.has(`${row.login_entry_id}::${row.domain}`)) {
    return 'active_tab_open';
  }
  // A previously logged-in/active account that no longer has a live tab has
  // been superseded -> "used" (red), while still within window.
  if (row.status === 'logged_in' || row.status === 'active_tab_open' || row.active_tab_id) {
    return 'used';
  }
  return row.status;
}

function key(loginEntryId: string, domain: string): string {
  return `${loginEntryId}::${domain}`;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { throw new Error('ASSERT FAILED: ' + msg); }
}

const future = () => new Date(Date.now() + LOGGED_IN_DURATION_MS - 60000).toISOString();

function test_active_when_live_tab_holds_it() {
  const now = Date.now();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1',
  };
  const live = new Set([key('acc-1', 'example.com')]);
  assert(computeCurrentStatus(row, now, live) === 'active_tab_open',
    'account with a live tab is active_tab_open');
  console.log('  ✓ account with a live tab -> active_tab_open');
}

function test_logged_in_without_live_tab_becomes_used() {
  const now = Date.now();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1',
  };
  // No live tabs -> even though the stored active_tab_id is set, it's stale.
  const live = new Set<string>();
  assert(computeCurrentStatus(row, now, live) === 'used',
    'logged-in account with no live tab -> used (stale active_tab_id ignored)');
  console.log('  ✓ superseded logged-in account (no live tab) -> used');
}

// THE core regression: two tabs on the SAME domain with DIFFERENT accounts must
// BOTH read as active. The old single-active-slot model made one of them flip
// to "used"/"never_used"; the derived model keeps both active.
function test_two_accounts_same_domain_both_active() {
  const now = Date.now();
  const rowA: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1',
  };
  const rowB: StatusRow = {
    login_entry_id: 'acc-2', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-2',
  };
  const live = new Set([
    key('acc-1', 'example.com'),
    key('acc-2', 'example.com'),
  ]);
  assert(computeCurrentStatus(rowA, now, live) === 'active_tab_open',
    'account 1 (tab 1) is active');
  assert(computeCurrentStatus(rowB, now, live) === 'active_tab_open',
    'account 2 (tab 2) is active — both accounts active on the same domain');
  console.log('  ✓ two tabs / two accounts / same domain -> BOTH active_tab_open');
}

// Closing tab 2 (account 2) must demote ONLY account 2; account 1 stays active
// because its tab is still live.
function test_closing_one_tab_only_demotes_that_account() {
  const now = Date.now();
  const rowA: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1',
  };
  const rowB: StatusRow = {
    login_entry_id: 'acc-2', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-2',
  };
  // Tab 2 closed -> only acc-1 remains live.
  const live = new Set([key('acc-1', 'example.com')]);
  assert(computeCurrentStatus(rowA, now, live) === 'active_tab_open',
    'account 1 stays active after tab 2 closes');
  assert(computeCurrentStatus(rowB, now, live) === 'used',
    'account 2 becomes "used" (still within window) after its tab closes');
  console.log('  ✓ closing one tab demotes only that account');
}

// Switching tabs must NOT reset statuses to never_used. As long as a tab is
// live within the window, its account keeps computing to active.
function test_switching_tabs_keeps_statuses() {
  const now = Date.now();
  const rowA: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1',
  };
  const rowB: StatusRow = {
    login_entry_id: 'acc-2', domain: 'example.com',
    status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-2',
  };
  const live = new Set([
    key('acc-1', 'example.com'),
    key('acc-2', 'example.com'),
  ]);
  // Regardless of which tab is "focused", the live set is the same, so both
  // accounts stay active — nothing flips to never_used.
  assert(computeCurrentStatus(rowA, now, live) !== 'never_used',
    'switching tabs does not reset account 1 to never_used');
  assert(computeCurrentStatus(rowB, now, live) !== 'never_used',
    'switching tabs does not reset account 2 to never_used');
  console.log('  ✓ switching tabs never resets accounts to never_used');
}

function test_resets_to_never_used_after_24h() {
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
  // Even a live tab resets the account after the window lapses.
  const rowActive: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'active_tab_open', logged_in_until: past, active_tab_id: 'tab-2',
  };
  const live = new Set([key('acc-1', 'example.com')]);
  assert(computeCurrentStatus(rowActive, now, live) === 'never_used',
    'expired active account should reset to never_used');
  const rowUsed: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: past, active_tab_id: null,
  };
  assert(computeCurrentStatus(rowUsed, now, new Set()) === 'never_used',
    'expired used account should reset to never_used');
  console.log('  ✓ after 24h everything refreshes to never_used');
}

function test_resets_after_many_days() {
  const now = Date.now();
  const old = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: old, active_tab_id: 'tab-x',
  };
  assert(computeCurrentStatus(row, now, new Set([key('acc-1', 'example.com')])) === 'never_used',
    'week-old login resets to never_used');
  console.log('  ✓ week-old login resets to never_used');
}

function test_never_used_unchanged() {
  const now = Date.now();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'never_used', logged_in_until: null, active_tab_id: null,
  };
  assert(computeCurrentStatus(row, now, new Set()) === 'never_used', 'never_used stays never_used');
  console.log('  ✓ never_used stays never_used');
}

function test_login_failed_unchanged() {
  const now = Date.now();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'login_failed', logged_in_until: null, active_tab_id: null,
  };
  assert(computeCurrentStatus(row, now, new Set()) === 'login_failed', 'login_failed stays login_failed');
  console.log('  ✓ login_failed stays login_failed');
}

function test_needs_2fa_unchanged() {
  const now = Date.now();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'needs_2fa', logged_in_until: null, active_tab_id: null,
  };
  assert(computeCurrentStatus(row, now, new Set()) === 'needs_2fa', 'needs_2fa stays needs_2fa');
  console.log('  ✓ needs_2fa stays needs_2fa');
}

function test_boundary_at_expiry() {
  const now = Date.now();
  const live = new Set([key('acc-1', 'example.com')]);
  // Exactly at expiry (not past): still within window -> active.
  const exact = new Date(now).toISOString();
  const row: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: exact, active_tab_id: 'tab-b',
  };
  assert(computeCurrentStatus(row, now, live) === 'active_tab_open',
    'at exact expiry the account is still active');
  // 1ms past -> reset.
  const justPast = new Date(now - 1).toISOString();
  const row2: StatusRow = {
    login_entry_id: 'acc-1', domain: 'example.com',
    status: 'logged_in', logged_in_until: justPast, active_tab_id: 'tab-b',
  };
  assert(computeCurrentStatus(row2, now, live) === 'never_used',
    '1ms past expiry resets to never_used');
  console.log('  ✓ boundary: active at exact expiry, never_used 1ms past');
}

function runAllTests() {
  console.log('=== Status Manager Expiry + Derived Active-Tab Tests ===');
  try {
    test_active_when_live_tab_holds_it();
    test_logged_in_without_live_tab_becomes_used();
    test_two_accounts_same_domain_both_active();
    test_closing_one_tab_only_demotes_that_account();
    test_switching_tabs_keeps_statuses();
    test_resets_to_never_used_after_24h();
    test_resets_after_many_days();
    test_never_used_unchanged();
    test_login_failed_unchanged();
    test_needs_2fa_unchanged();
    test_boundary_at_expiry();
    console.log('✓ All expiry + derived active-tab tests passed.');
  } catch (err: any) {
    console.error('✗ ' + (err?.message || err));
    process.exit(1);
  }
}

runAllTests();
