import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  pbkdf2Sync,
  timingSafeEqual,
} from 'crypto';
import * as bcrypt from 'bcrypt';

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
  return pbkdf2Sync(
    masterKey,
    workspaceId,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256',
  );
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

/**
 * Encrypt a password for workspace SMTP settings.
 * Uses workspace ID as context for key derivation.
 */
export function encryptPassword(
  password: string,
  masterKey: string,
  workspaceId: string,
): string {
  const derivedKey = deriveKey(masterKey, workspaceId);
  return encrypt(password, derivedKey);
}

/**
 * Decrypt a password from workspace SMTP settings.
 * Uses workspace ID as context for key derivation.
 */
export function decryptPassword(
  encryptedPassword: string,
  masterKey: string,
  workspaceId: string,
): string {
  const derivedKey = deriveKey(masterKey, workspaceId);
  return decrypt(encryptedPassword, derivedKey);
}

// =============================================================================
// Token and Password Utilities (for user invitation system)
// =============================================================================

const BCRYPT_ROUNDS = 12;

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate a secure random token with its SHA-256 hash.
 * Used for invitations, password resets, session tokens.
 * Returns 64-char hex token (256 bits of entropy).
 */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Generate an API key with prefix.
 * Format: sk_live_<64 hex chars>
 */
export function generateApiKeyToken(): {
  key: string;
  hash: string;
  prefix: string;
} {
  const randomPart = randomBytes(32).toString('hex');
  const key = `sk_live_${randomPart}`;
  const hash = createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 15); // "sk_live_" + 7 chars
  return { key, hash, prefix };
}

/**
 * Hash a token using SHA-256.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verify a token against a stored hash using constant-time comparison.
 * Prevents timing attacks.
 */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  const computedHash = createHash('sha256').update(token).digest('hex');
  try {
    return timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Hash a password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
