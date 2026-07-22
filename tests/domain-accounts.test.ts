// ============================================================================
// Tests for Per-Site Account Logic (#3) and Duplicate Prevention (#1)
// ============================================================================
//
// These mirror the pure decision logic used in login-entry-manager:
// 1. listForDomain returns accounts for the given domain plus legacy
//    unscoped ('') accounts.
// 2. existsForDomain detects a duplicate username within the same domain,
//    case-insensitively and trimming whitespace.

import assert from 'node:assert';

interface Row {
  id: string;
  usernameOrEmail: string;
  domain: string;
}

// --- Pure re-implementations of the manager's filtering rules ---------------

function listForDomain(rows: Row[], domain: string): Row[] {
  const d = domain.trim().toLowerCase();
  return rows.filter((r) => r.domain === d || r.domain === '');
}

function existsForDomain(rows: Row[], usernameOrEmail: string, domain: string): boolean {
  const d = domain.trim().toLowerCase();
  const u = usernameOrEmail.trim().toLowerCase();
  return rows.some((r) => r.domain === d && r.usernameOrEmail.trim().toLowerCase() === u);
}

// --- Fixtures ---------------------------------------------------------------

const ROWS: Row[] = [
  { id: 'a', usernameOrEmail: 'me@example.com', domain: 'example.com' },
  { id: 'b', usernameOrEmail: 'work@company.com', domain: 'company.com' },
  { id: 'c', usernameOrEmail: 'legacy@old.com', domain: '' }, // unscoped/legacy
];

// --- Tests ------------------------------------------------------------------

console.log('Running per-site account tests...');

// listForDomain
{
  const r = listForDomain(ROWS, 'example.com');
  const ids = r.map((x) => x.id).sort();
  assert.deepStrictEqual(ids, ['a', 'c'], 'example.com sees its own + legacy');
  console.log('  ✓ listForDomain returns site accounts + legacy unscoped');
}
{
  const r = listForDomain(ROWS, 'company.com');
  const ids = r.map((x) => x.id).sort();
  assert.deepStrictEqual(ids, ['b', 'c'], 'company.com sees its own + legacy');
  console.log('  ✓ listForDomain isolates other sites\' accounts');
}
{
  const r = listForDomain(ROWS, 'nowhere.com');
  const ids = r.map((x) => x.id).sort();
  assert.deepStrictEqual(ids, ['c'], 'unknown domain only sees legacy');
  console.log('  ✓ Unknown domain only sees legacy accounts');
}
{
  const r = listForDomain(ROWS, 'EXAMPLE.COM');
  const ids = r.map((x) => x.id).sort();
  assert.deepStrictEqual(ids, ['a', 'c'], 'domain match is case-insensitive');
  console.log('  ✓ listForDomain lowercases the domain');
}

// existsForDomain (duplicate prevention)
{
  assert.strictEqual(existsForDomain(ROWS, 'me@example.com', 'example.com'), true, 'exact dup');
  console.log('  ✓ Detects exact duplicate on same domain');
}
{
  assert.strictEqual(existsForDomain(ROWS, '  ME@Example.COM  ', 'example.com'), true, 'case+trim dup');
  console.log('  ✓ Duplicate check ignores case and surrounding whitespace');
}
{
  assert.strictEqual(existsForDomain(ROWS, 'me@example.com', 'company.com'), false, 'same user diff domain');
  console.log('  ✓ Same username on a different domain is NOT a duplicate');
}
{
  assert.strictEqual(existsForDomain(ROWS, 'new@example.com', 'example.com'), false, 'new user');
  console.log('  ✓ A genuinely new username is allowed');
}

console.log('✓ All per-site account tests passed.');
