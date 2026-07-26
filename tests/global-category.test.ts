// ============================================================================
// Tests for Global-Category behaviour (v1.2.0)
// ============================================================================
//
// Two pure re-implementations of the decision logic changed in this release:
//
// 1. buildVisibleStatuses — the sidebar's `visibleStatuses` for an ACTIVE
//    category. A GLOBAL category shows ALL its member accounts on ANY site:
//    accounts already used on the site keep their status; members never used
//    here are surfaced as 'never_used'. A PRIVATE category is a plain per-site
//    filter.
//
// 2. groupSiteAccounts — Settings › Site accounts grouping. An account appears
//    under a site if that is its home domain OR it has a status row for that
//    site (so a global account, once logged in on a site, shows up there).
//    No account is listed twice under the same site.

import assert from 'node:assert';

// --- 1. Sidebar visibleStatuses --------------------------------------------

interface Entry { id: string; }
interface EntryWithStatus { entry: Entry; status: string | null; }
interface Category { id: string; scope: 'global' | 'private'; accountIds: string[]; }

function buildVisibleStatuses(
  activeCategoryId: string | null,
  categories: Category[],
  domainStatuses: EntryWithStatus[],
  allEntries: Entry[],
): EntryWithStatus[] {
  if (!activeCategoryId) return domainStatuses;
  const cat = categories.find(c => c.id === activeCategoryId);
  if (!cat) return domainStatuses;
  const idSet = new Set(cat.accountIds);
  if (cat.scope === 'global') {
    const byId = new Map(domainStatuses.map(s => [s.entry.id, s]));
    const result: EntryWithStatus[] = [];
    for (const accId of cat.accountIds) {
      const existing = byId.get(accId);
      if (existing) { result.push(existing); continue; }
      const entry = allEntries.find(e => e.id === accId);
      if (entry) result.push({ entry, status: 'never_used' });
    }
    return result;
  }
  return domainStatuses.filter(s => idSet.has(s.entry.id));
}

console.log('Running global-category tests...');

const ALL: Entry[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

// Global category on a site where only 'a' has been used.
{
  const cats: Category[] = [{ id: 'g', scope: 'global', accountIds: ['a', 'b'] }];
  const domainStatuses: EntryWithStatus[] = [{ entry: { id: 'a' }, status: 'used' }];
  const vis = buildVisibleStatuses('g', cats, domainStatuses, ALL);
  assert.deepStrictEqual(vis.map(v => v.entry.id), ['a', 'b'], 'shows both members');
  assert.strictEqual(vis[0].status, 'used', 'used account keeps its status');
  assert.strictEqual(vis[1].status, 'never_used', 'unused member is never_used');
  console.log('  ✓ Global category shows every member on a site (used + never_used)');
}

// Global category on a brand-new site: no statuses at all.
{
  const cats: Category[] = [{ id: 'g', scope: 'global', accountIds: ['a', 'b', 'c'] }];
  const vis = buildVisibleStatuses('g', cats, [], ALL);
  assert.deepStrictEqual(vis.map(v => v.entry.id), ['a', 'b', 'c'], 'all members show');
  assert.ok(vis.every(v => v.status === 'never_used'), 'all never_used on new site');
  console.log('  ✓ Global category shows all members as never_used on an unconnected site');
}

// Private category is a plain per-site filter (members not on the site vanish).
{
  const cats: Category[] = [{ id: 'p', scope: 'private', accountIds: ['a', 'b'] }];
  const domainStatuses: EntryWithStatus[] = [{ entry: { id: 'a' }, status: 'used' }];
  const vis = buildVisibleStatuses('p', cats, domainStatuses, ALL);
  assert.deepStrictEqual(vis.map(v => v.entry.id), ['a'], 'private only shows site accounts');
  console.log('  ✓ Private category stays a per-site filter');
}

// No active category returns the full domain list untouched.
{
  const domainStatuses: EntryWithStatus[] = [{ entry: { id: 'a' }, status: 'used' }];
  const vis = buildVisibleStatuses(null, [], domainStatuses, ALL);
  assert.deepStrictEqual(vis, domainStatuses, 'null category = passthrough');
  console.log('  ✓ No active category returns the full list');
}

// --- 2. Settings site-account grouping -------------------------------------

interface AccountRow { id: string; domain: string; }        // home domain
interface StatusRow { loginEntryId: string; domain: string; status: string; }

function groupSiteAccounts(entries: AccountRow[], statuses: StatusRow[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  const push = (domain: string, id: string) => {
    const key = `${domain}\u0000${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const list = groups.get(domain);
    if (list) list.push(id);
    else groups.set(domain, [id]);
  };
  for (const e of entries) push(e.domain || '', e.id);
  const byId = new Set(entries.map(e => e.id));
  for (const s of statuses) {
    if (!s.domain) continue;
    if (!byId.has(s.loginEntryId)) continue;
    push(s.domain, s.loginEntryId);
  }
  return groups;
}

// A global account (home domain '') used on example.com now appears there.
{
  const entries: AccountRow[] = [{ id: 'a', domain: '' }];
  const statuses: StatusRow[] = [{ loginEntryId: 'a', domain: 'example.com', status: 'used' }];
  const g = groupSiteAccounts(entries, statuses);
  assert.deepStrictEqual(g.get('example.com'), ['a'], 'global account shows under used site');
  assert.deepStrictEqual(g.get(''), ['a'], 'and still under the unscoped group');
  console.log('  ✓ Global account used on a site is grouped under that site');
}

// No duplicate when a per-site account also has a status row for its own site.
{
  const entries: AccountRow[] = [{ id: 'a', domain: 'example.com' }];
  const statuses: StatusRow[] = [{ loginEntryId: 'a', domain: 'example.com', status: 'used' }];
  const g = groupSiteAccounts(entries, statuses);
  assert.deepStrictEqual(g.get('example.com'), ['a'], 'no duplicate under the same site');
  console.log('  ✓ Account is never listed twice under the same site');
}

// A status row for an account that no longer exists is ignored.
{
  const entries: AccountRow[] = [{ id: 'a', domain: 'example.com' }];
  const statuses: StatusRow[] = [{ loginEntryId: 'ghost', domain: 'other.com', status: 'used' }];
  const g = groupSiteAccounts(entries, statuses);
  assert.strictEqual(g.has('other.com'), false, 'orphan status ignored');
  console.log('  ✓ Orphaned status rows are ignored');
}

console.log('✓ All global-category tests passed.');
