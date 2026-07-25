// ============================================================================
// Tests for Status Manager Expiry + Stored Active-Tab Logic
// ============================================================================
//
// Mirrors StatusManager.computeCurrentStatus (src/main/services/status-manager.ts).
//
// Status rules (stored active-tab model, multi-tab capable):
// 1. After the 24h window (logged_in_until) lapses, ANY non-neutral status
//    resets to "never_used" ("refresh to never used after 24 hours").
// 2. Within the window, a row that holds an active tab (its OWN stored
//    `active_tab_id`) is "active_tab_open". Because EACH (account, domain) row
//    owns its own active_tab_id, TWO tabs on the SAME domain — each with a
//    DIFFERENT account — can BOTH be active at once (no demotion of the other).
// 3. A previously logged-in account whose tab has closed (active_tab_id NULL)
//    is "used" (shown red) while still within the window.
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

// Faithful mirror of StatusManager.computeCurrentStatus(row, nowMs).
// Mirror of StatusManager.computeCurrentStatus(row, nowMs, focusedTabId).
//
// `focusedTabId` selects the "active" interpretation:
//  - VAULT SIDEBAR (focusedTabId provided): only the focused tab's account is
//    "active_tab_open"; other open-tab accounts read "used" -> at most ONE
//    active tab shown.
//  - SETTINGS › Site accounts (focusedTabId === undefined): every open-tab
//    account is "active_tab_open" -> multiple active tabs shown.
function computeCurrentStatus(row: StatusRow, nowMs: number, focusedTabId?: string | null): LoginStatus {
  // 24h window check: once the window lapses, the account is "never_used".
  if (row.logged_in_until) {
    const untilMs = new Date(row.logged_in_until).getTime();
    if (nowMs > untilMs) {
      return 'never_used';
    }
  }
  if (row.active_tab_id) {
    if (focusedTabId === undefined || row.active_tab_id === focusedTabId) {
      return 'active_tab_open';
    }
    return 'used';
  }
  // A previously logged-in/active account whose tab has closed -> "used".
  if (row.status === 'logged_in' || row.status === 'active_tab_open') {
    return 'used';
  }
  return row.status;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { throw new Error('ASSERT FAILED: ' + msg); }
}

const future = () => new Date(Date.now() + LOGGED_IN_DURATION_MS - 60000).toISOString();

function test_active_when_row_holds_tab() {
  const now = Date.now();
  const row: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1' };
  assert(computeCurrentStatus(row, now) === 'active_tab_open',
    'account whose row holds a tab is active_tab_open');
  console.log('  ✓ row with active_tab_id -> active_tab_open');
}

function test_logged_in_without_tab_becomes_used() {
  const now = Date.now();
  const row: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: null };
  assert(computeCurrentStatus(row, now) === 'used',
    'logged-in account whose tab closed -> used');
  console.log('  ✓ superseded logged-in account (tab closed) -> used');
}

// SETTINGS view: two tabs on the SAME domain with DIFFERENT accounts must BOTH
// read as active (focusedTabId omitted -> every open-tab account is active).
function test_settings_shows_all_open_tabs_active() {
  const now = Date.now();
  const rowA: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1' };
  const rowB: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-2' };
  // No focusedTabId -> Settings interpretation.
  assert(computeCurrentStatus(rowA, now) === 'active_tab_open', 'Settings: account 1 active');
  assert(computeCurrentStatus(rowB, now) === 'active_tab_open', 'Settings: account 2 active');
  console.log('  ✓ Settings › Site accounts -> ALL open-tab accounts active');
}

// VAULT SIDEBAR view: with two tabs open, ONLY the focused tab's account is
// "Active tab"; the other open-tab account reads "used". Exactly one active.
function test_sidebar_shows_only_focused_tab_active() {
  const now = Date.now();
  const rowA: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1' };
  const rowB: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-2' };
  // Focused on tab 1.
  assert(computeCurrentStatus(rowA, now, 'tab-1') === 'active_tab_open',
    'Sidebar (focus tab 1): account 1 is the Active tab');
  assert(computeCurrentStatus(rowB, now, 'tab-1') === 'used',
    'Sidebar (focus tab 1): account 2 is "used", not a second Active tab');
  console.log('  ✓ Sidebar -> ONLY the focused tab account is Active tab');
}

// Switching the focused tab moves the single "Active tab" to the other
// account — it must NOT reset either account to never_used.
function test_sidebar_switch_moves_single_active() {
  const now = Date.now();
  const rowA: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1' };
  const rowB: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-2' };
  // Now focus tab 2.
  assert(computeCurrentStatus(rowA, now, 'tab-2') === 'used',
    'Sidebar (focus tab 2): account 1 is now "used"');
  assert(computeCurrentStatus(rowB, now, 'tab-2') === 'active_tab_open',
    'Sidebar (focus tab 2): account 2 is now the Active tab');
  // Neither ever computes to never_used while a tab holds it in-window.
  assert(computeCurrentStatus(rowA, now, 'tab-2') !== 'never_used', 'account 1 not never_used on switch');
  assert(computeCurrentStatus(rowB, now, 'tab-2') !== 'never_used', 'account 2 not never_used on switch');
  console.log('  ✓ Sidebar switch moves the single Active tab (no never_used reset)');
}

// Closing tab 2 clears ONLY account 2's active_tab_id; account 1 stays active.
function test_closing_one_tab_only_demotes_that_account() {
  const now = Date.now();
  const rowA: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: 'tab-1' };
  const rowB: StatusRow = { status: 'logged_in', logged_in_until: future(), active_tab_id: null }; // tab 2 closed
  assert(computeCurrentStatus(rowA, now) === 'active_tab_open', 'account 1 stays active');
  assert(computeCurrentStatus(rowB, now) === 'used', 'account 2 becomes used after its tab closes');
  console.log('  ✓ closing one tab demotes only that account');
}

function test_resets_to_never_used_after_24h() {
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
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
  console.log('=== Status Manager Expiry + Stored Active-Tab Tests ===');
  try {
    test_active_when_row_holds_tab();
    test_logged_in_without_tab_becomes_used();
    test_settings_shows_all_open_tabs_active();
    test_sidebar_shows_only_focused_tab_active();
    test_sidebar_switch_moves_single_active();
    test_closing_one_tab_only_demotes_that_account();
    test_resets_to_never_used_after_24h();
    test_resets_after_many_days();
    test_never_used_unchanged();
    test_login_failed_unchanged();
    test_needs_2fa_unchanged();
    test_boundary_at_expiry();
    console.log('✓ All expiry + stored active-tab tests passed.');
  } catch (err: any) {
    console.error('✗ ' + (err?.message || err));
    process.exit(1);
  }
}

runAllTests();
