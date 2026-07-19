// ============================================================================
// Type declarations for the 'keytar' module
// keytar is a native Node.js addon for accessing the system keychain
// (Windows Credential Manager on Windows, Keychain on macOS, libsecret on Linux)
// ============================================================================

declare module 'keytar' {
  /**
   * Get the password stored at the service/account combination.
   * Returns null if no password is found.
   */
  export function getPassword(service: string, account: string): Promise<string | null>;

  /**
   * Set a password for the service/account combination.
   */
  export function setPassword(service: string, account: string, password: string): Promise<void>;

  /**
   * Delete the password stored at the service/account combination.
   * Returns true if a password was deleted, false otherwise.
   */
  export function deletePassword(service: string, account: string): Promise<boolean>;

  /**
   * Find all accounts for a given service.
   */
  export function findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;

  /**
   * Find all services in the keychain.
   */
  export function findPassword(service: string): Promise<string | null>;
}
