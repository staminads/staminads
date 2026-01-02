import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32;

/**
 * Derive a workspace-specific encryption key from master key and workspace ID.
 * Uses PBKDF2 with SHA-256 to derive a unique key per workspace.
 */
export function deriveKey(masterKey: string, workspaceId: string): Buffer {
  return pbkdf2Sync(masterKey, workspaceId, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string using AES-256-GCM with a derived key.
 * Returns format: iv:authTag:encryptedData (all hex encoded)
 */
export function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 * Expects format: iv:authTag:encryptedData (all hex encoded)
 */
export function decrypt(encryptedText: string, key: Buffer): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypt an API key for a specific workspace.
 */
export function encryptApiKey(
  apiKey: string,
  masterKey: string,
  workspaceId: string,
): string {
  const derivedKey = deriveKey(masterKey, workspaceId);
  return encrypt(apiKey, derivedKey);
}

/**
 * Decrypt an API key for a specific workspace.
 */
export function decryptApiKey(
  encryptedApiKey: string,
  masterKey: string,
  workspaceId: string,
): string {
  const derivedKey = deriveKey(masterKey, workspaceId);
  return decrypt(encryptedApiKey, derivedKey);
}
