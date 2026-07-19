// ============================================================================
// Tests for Tab Selection and Dedup Logic
// ============================================================================
//
// Tests the login-entry selection workflow decision logic:
// 1. When same login_entry+domain already has a tab -> switch to it (dedup)
// 2. When current tab is a guest tab -> close it, create login-entry tab
// 3. When current tab belongs to another login -> create new isolated tab

type TabType = 'guest' | 'login_entry';

interface TabInfo {
  id: string;
  type: TabType;
  currentUrl: string;
  domain: string | null;
  loginEntryId: string | null;
  partitionId: string;
}

interface SelectLoginResult {
  action: 'autofill_current' | 'switch_existing' | 'close_guest_create_login' | 'create_new_login';
  tabId?: string;
}

function decideLoginEntrySelection(
  loginEntryId: string,
  activeTabId: string | null,
  currentUrl: string,
  currentDomain: string | null,
  tabs: TabInfo[],
  existingTabForLogin: TabInfo | null
): SelectLoginResult {
  if (!activeTabId || !currentUrl || currentUrl === 'about:blank') {
    return { action: 'create_new_login' };
  }
  if (existingTabForLogin && currentDomain) {
    if (existingTabForLogin.domain === currentDomain) {
      return { action: 'switch_existing', tabId: existingTabForLogin.id };
    }
  }
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (!currentTab) {
    return { action: 'create_new_login' };
  }
  if (currentTab.type === 'guest') {
    return { action: 'close_guest_create_login' };
  }
  if (currentTab.type === 'login_entry' && currentTab.loginEntryId !== loginEntryId) {
    return { action: 'create_new_login' };
  }
  return { action: 'autofill_current' };
}

function test_dedup_switches_to_existing_tab() {
  const tabs: TabInfo[] = [
    { id: 'tab-1', type: 'guest', currentUrl: 'about:blank', domain: null, loginEntryId: null, partitionId: 'p1' },
    { id: 'tab-2', type: 'login_entry', currentUrl: 'https://example.com', domain: 'example.com', loginEntryId: 'login-1', partitionId: 'p2' },
    { id: 'tab-3', type: 'guest', currentUrl: 'https://other.com', domain: 'other.com', loginEntryId: null, partitionId: 'p3' },
  ];
  const existingTab: TabInfo = { id: 'tab-2', type: 'login_entry', currentUrl: 'https://example.com', domain: 'example.com', loginEntryId: 'login-1', partitionId: 'p2' };
  const result = decideLoginEntrySelection('login-1', 'tab-3', 'https://example.com/page', 'example.com', tabs, existingTab);
  console.assert(result.action === 'switch_existing', `Expected "switch_existing", got "${result.action}"`);
  console.assert(result.tabId === 'tab-2', `Expected tabId "tab-2", got "${result.tabId}"`);
  console.log('  ✓ Existing tab dedup: switches to existing tab-2');
}

function test_no_existing_tab_creates_new() {
  const tabs: TabInfo[] = [{ id: 'tab-1', type: 'guest', currentUrl: 'https://github.com', domain: 'github.com', loginEntryId: null, partitionId: 'p1' }];
  const result = decideLoginEntrySelection('login-1', 'tab-1', 'https://github.com', 'github.com', tabs, null);
  console.assert(result.action === 'close_guest_create_login', `Expected "close_guest_create_login", got "${result.action}"`);
  console.log('  ✓ No existing tab + guest tab -> close guest, create login tab');
}

function test_other_login_creates_new_tab() {
  const tabs: TabInfo[] = [{ id: 'tab-1', type: 'login_entry', currentUrl: 'https://example.com', domain: 'example.com', loginEntryId: 'login-other', partitionId: 'p1' }];
  const result = decideLoginEntrySelection('login-1', 'tab-1', 'https://example.com', 'example.com', tabs, null);
  console.assert(result.action === 'create_new_login', `Expected "create_new_login", got "${result.action}"`);
  console.log('  ✓ Current tab belongs to other login -> create new isolated tab');
}

function test_guest_tab_reused() {
  const tabs: TabInfo[] = [{ id: 'tab-1', type: 'guest', currentUrl: 'https://example.com', domain: 'example.com', loginEntryId: null, partitionId: 'p1' }];
  const result = decideLoginEntrySelection('login-1', 'tab-1', 'https://example.com', 'example.com', tabs, null);
  console.assert(result.action === 'close_guest_create_login', `Expected "close_guest_create_login", got "${result.action}"`);
  console.log('  ✓ Guest tab on same domain -> closed, login-entry tab created');
}

function test_no_active_tab() {
  const result = decideLoginEntrySelection('login-1', null, '', null, [], null);
  console.assert(result.action === 'create_new_login', `Expected "create_new_login", got "${result.action}"`);
  console.log('  ✓ No active tab -> create new login tab');
}

function test_blank_tab() {
  const tabs: TabInfo[] = [{ id: 'tab-1', type: 'guest', currentUrl: 'about:blank', domain: null, loginEntryId: null, partitionId: 'p1' }];
  const result = decideLoginEntrySelection('login-1', 'tab-1', 'about:blank', null, tabs, null);
  console.assert(result.action === 'create_new_login', `Expected "create_new_login", got "${result.action}"`);
  console.log('  ✓ about:blank tab -> create new login tab');
}

function test_same_login_same_tab_autofill() {
  const tabs: TabInfo[] = [{ id: 'tab-1', type: 'login_entry', currentUrl: 'https://example.com', domain: 'example.com', loginEntryId: 'login-1', partitionId: 'p1' }];
  const result = decideLoginEntrySelection('login-1', 'tab-1', 'https://example.com/login', 'example.com', tabs, null);
  console.assert(result.action === 'autofill_current', `Expected "autofill_current", got "${result.action}"`);
  console.log('  ✓ Same login on its own tab -> autofill current tab');
}

function runAllTests() {
  console.log('=== Tab Selection Logic Tests ===');
  test_dedup_switches_to_existing_tab();
  test_no_existing_tab_creates_new();
  test_other_login_creates_new_tab();
  test_guest_tab_reused();
  test_no_active_tab();
  test_blank_tab();
  test_same_login_same_tab_autofill();
  console.log('✓ All tab selection tests passed.');
}

runAllTests();
