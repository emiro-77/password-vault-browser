// ============================================================================
// Tests for the encrypted backup envelope (vault export / import)
// ============================================================================
//
// The real crypto lives in src/main/services/vault-transfer.ts, but that module
// imports Electron-only dependencies (db / credential-store), so — like the
// other suites — we mirror the exact envelope construction here and assert the
// round-trip and failure modes. This locks in the CROSS-PLATFORM format
// contract (PBKDF2-SHA256 + AES-256-GCM, base64 fields, JSON envelope) that any
// future Android / iOS / macOS / Linux version must interoperate with.

import * as crypto from 'crypto';
import assert from 'node:assert';

const FORMAT_MAGIC = 'vault-browser-backup';
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;
const KEY_LEN = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

function encryptEnvelope(payload: unknown, passphrase: string): string {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    format: FORMAT_MAGIC,
    formatVersion: FORMAT_VERSION,
    app: 'Vault Browser Desktop',
    createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: salt.toString('base64') },
    cipher: { name: 'AES-256-GCM', iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    ciphertext: ciphertext.toString('base64'),
  }, null, 2);
}

function decryptEnvelope(fileContents: string, passphrase: string): any {
  const env = JSON.parse(fileContents);
  if (env.format !== FORMAT_MAGIC) throw new Error('Unrecognized file');
  if (env.formatVersion > FORMAT_VERSION) throw new Error('Newer format');
  const salt = Buffer.from(env.kdf.salt, 'base64');
  const iv = Buffer.from(env.cipher.iv, 'base64');
  const authTag = Buffer.from(env.cipher.authTag, 'base64');
  const ciphertext = Buffer.from(env.ciphertext, 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

const samplePayload = {
  loginEntries: [
    { id: 'e1', label: 'Email', usernameOrEmail: 'a@b.com', domain: 'b.com', password: 'p@ss w0rd 🔐', createdAt: 'x', updatedAt: 'y' },
  ],
  categories: [{ id: 'c1', name: 'Work' }],
  bookmarks: [],
};

// 1) Round-trip with the correct passphrase returns the identical payload.
{
  const file = encryptEnvelope(samplePayload, 'correct horse');
  const out = decryptEnvelope(file, 'correct horse');
  assert.deepStrictEqual(out, samplePayload, 'round-trip payload must match exactly (incl. unicode password)');
  console.log('  ✓ Encrypt→decrypt round-trip preserves the payload');
}

// 2) The envelope is valid JSON and never leaks plaintext.
{
  const file = encryptEnvelope(samplePayload, 'pw');
  const env = JSON.parse(file);
  assert.strictEqual(env.format, FORMAT_MAGIC, 'magic string present');
  assert.strictEqual(env.cipher.name, 'AES-256-GCM');
  assert.strictEqual(env.kdf.name, 'PBKDF2');
  assert.ok(!file.includes('a@b.com'), 'username must not appear in the encrypted file');
  assert.ok(!file.includes('p@ss'), 'password must not appear in the encrypted file');
  console.log('  ✓ Envelope is JSON, self-describing, and leaks no plaintext');
}

// 3) Wrong passphrase fails (GCM auth tag rejects it).
{
  const file = encryptEnvelope(samplePayload, 'right');
  assert.throws(() => decryptEnvelope(file, 'wrong'), 'wrong passphrase must throw');
  console.log('  ✓ Wrong passphrase is rejected by the GCM auth tag');
}

// 4) Tampered ciphertext fails (integrity protection).
{
  const env = JSON.parse(encryptEnvelope(samplePayload, 'pw'));
  const raw = Buffer.from(env.ciphertext, 'base64');
  raw[0] ^= 0xff; // flip a bit
  env.ciphertext = raw.toString('base64');
  assert.throws(() => decryptEnvelope(JSON.stringify(env), 'pw'), 'tampered ciphertext must throw');
  console.log('  ✓ Tampered ciphertext is rejected (integrity check)');
}

// 5) A backup from a newer format version is refused (forward-compat guard).
{
  const env = JSON.parse(encryptEnvelope(samplePayload, 'pw'));
  env.formatVersion = FORMAT_VERSION + 1;
  assert.throws(() => decryptEnvelope(JSON.stringify(env), 'pw'), 'newer format must be refused');
  console.log('  ✓ Newer format version is refused');
}

console.log('✓ All vault-transfer crypto tests passed.');
