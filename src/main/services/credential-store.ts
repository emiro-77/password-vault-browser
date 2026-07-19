// ============================================================================
// Credential Store — Windows secure credential storage abstraction
// ============================================================================
// Primary: Windows Credential Manager via keytar (native)
// Fallback: AES-256-GCM encryption with a randomly-generated key stored in
//          the app's userData directory (.pvb-key, mode 0600).
//
// Passwords are NEVER stored in plaintext in SQLite.
// The SQLite DB stores only a reference key name.

import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CREDENTIAL_SERVICE_NAME } from '../../shared/constants';

// ---- Keytar integration (Windows Credential Manager) ----

let keytarModule: typeof import('keytar') | null = null;

async function loadKeytar(): Promise<boolean> {
  if (keytarModule) return true;

  try {
    keytarModule = await import('keytar');
    console.log('[CredentialStore] Using keytar (Windows Credential Manager)');
    return true;
  } catch (err) {
    console.warn('[CredentialStore] keytar not available, using AES-256-GCM fallback:', (err as Error).message);
    return false;
  }
}

// ---- AES-256-GCM fallback ----

let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  const keyPath = path.join(app.getPath('userData'), '.pvb-key');

  if (encryptionKey) return encryptionKey;

  if (fs.existsSync(keyPath)) {
    encryptionKey = fs.readFileSync(keyPath);
  } else {
    encryptionKey = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, encryptionKey, { mode: 0o600 });
  }

  return encryptionKey;
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---- Public API ----

export type StorageMode = 'keytar' | 'aes-256-gcm';

let storageMode: StorageMode = 'aes-256-gcm';

export function getStorageMode(): StorageMode {
  return storageMode;
}

/**
 * Initialize the credential store.
 * Attempts keytar first, falls back to AES-256-GCM with file-based key.
 */
export async function initCredentialStore(): Promise<void> {
  const hasKeytar = await loadKeytar();
  storageMode = hasKeytar ? 'keytar' : 'aes-256-gcm';
  console.log(`[CredentialStore] Initialized (mode: ${storageMode})`);
}

/**
 * Save a credential (password) to secure storage.
 */
export async function saveCredential(refKey: string, password: string): Promise<void> {
  if (storageMode === 'keytar' && keytarModule) {
    await keytarModule.setPassword(CREDENTIAL_SERVICE_NAME, refKey, password);
  } else {
    const encryptedBlob = encrypt(password);
    const store = loadFallbackStore();
    store[refKey] = encryptedBlob;
    writeFallbackStore(store);
  }
}

/**
 * Get a credential (password) from secure storage.
 */
export async function getCredential(refKey: string): Promise<string | null> {
  if (storageMode === 'keytar' && keytarModule) {
    const password = await keytarModule.getPassword(CREDENTIAL_SERVICE_NAME, refKey);
    return password ?? null;
  } else {
    const store = loadFallbackStore();
    const encryptedBlob = store[refKey];
    if (!encryptedBlob) return null;
    try {
      return decrypt(encryptedBlob);
    } catch {
      console.error(`[CredentialStore] Failed to decrypt credential: ${refKey}`);
      return null;
    }
  }
}

/**
 * Delete a credential from secure storage.
 */
export async function deleteCredential(refKey: string): Promise<void> {
  if (storageMode === 'keytar' && keytarModule) {
    await keytarModule.deletePassword(CREDENTIAL_SERVICE_NAME, refKey);
  } else {
    const store = loadFallbackStore();
    delete store[refKey];
    writeFallbackStore(store);
  }
}

// ---- Fallback store file helpers ----

function fallbackStorePath(): string {
  return path.join(app.getPath('userData'), '.pvb-credentials.enc');
}

interface FallbackStore {
  [key: string]: string;
}

function loadFallbackStore(): FallbackStore {
  const storePath = fallbackStorePath();
  try {
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    console.warn('[CredentialStore] Failed to read fallback store, starting fresh');
  }
  return {};
}

function writeFallbackStore(store: FallbackStore): void {
  const storePath = fallbackStorePath();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 0), { mode: 0o600 });
}
