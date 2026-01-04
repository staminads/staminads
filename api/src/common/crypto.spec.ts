import {
  deriveKey,
  encrypt,
  decrypt,
  encryptApiKey,
  decryptApiKey,
  generateId,
  generateToken,
  generateApiKeyToken,
  hashToken,
  verifyTokenHash,
  hashPassword,
  verifyPassword,
} from './crypto';

describe('crypto', () => {
  const masterKey = 'test-master-key-for-encryption-purposes';
  const workspaceId = 'ws-123';

  describe('deriveKey', () => {
    it('returns a 32-byte buffer', () => {
      const key = deriveKey(masterKey, workspaceId);
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('produces consistent output for same inputs', () => {
      const key1 = deriveKey(masterKey, workspaceId);
      const key2 = deriveKey(masterKey, workspaceId);
      expect(key1.equals(key2)).toBe(true);
    });

    it('produces different keys for different workspaces', () => {
      const key1 = deriveKey(masterKey, 'ws-1');
      const key2 = deriveKey(masterKey, 'ws-2');
      expect(key1.equals(key2)).toBe(false);
    });

    it('produces different keys for different master keys', () => {
      const key1 = deriveKey('master-1', workspaceId);
      const key2 = deriveKey('master-2', workspaceId);
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('encrypt / decrypt', () => {
    it('encrypts and decrypts text correctly', () => {
      const key = deriveKey(masterKey, workspaceId);
      const plaintext = 'sk-ant-api03-secret-key';

      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext (due to random IV)', () => {
      const key = deriveKey(masterKey, workspaceId);
      const plaintext = 'test-text';

      const encrypted1 = encrypt(plaintext, key);
      const encrypted2 = encrypt(plaintext, key);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('encrypted text has correct format (iv:authTag:data)', () => {
      const key = deriveKey(masterKey, workspaceId);
      const encrypted = encrypt('test', key);

      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0].length).toBe(32); // 16 bytes = 32 hex chars (IV)
      expect(parts[1].length).toBe(32); // 16 bytes = 32 hex chars (auth tag)
      expect(parts[2].length).toBeGreaterThan(0); // encrypted data
    });

    it('handles empty string', () => {
      const key = deriveKey(masterKey, workspaceId);
      const encrypted = encrypt('', key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe('');
    });

    it('handles unicode characters', () => {
      const key = deriveKey(masterKey, workspaceId);
      const plaintext = '测试 テスト 🔐';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('handles long text', () => {
      const key = deriveKey(masterKey, workspaceId);
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('decrypt error handling', () => {
    it('throws for invalid format (wrong number of parts)', () => {
      const key = deriveKey(masterKey, workspaceId);
      expect(() => decrypt('invalid', key)).toThrow(
        'Invalid encrypted text format',
      );
      expect(() => decrypt('a:b', key)).toThrow(
        'Invalid encrypted text format',
      );
      expect(() => decrypt('a:b:c:d', key)).toThrow(
        'Invalid encrypted text format',
      );
    });

    it('throws for invalid IV length', () => {
      const key = deriveKey(masterKey, workspaceId);
      // IV should be 32 hex chars (16 bytes), using shorter
      expect(() =>
        decrypt('0123456789abcdef:' + '0'.repeat(32) + ':data', key),
      ).toThrow('Invalid IV length');
    });

    it('throws for invalid auth tag length', () => {
      const key = deriveKey(masterKey, workspaceId);
      // Auth tag should be 32 hex chars (16 bytes), using shorter
      expect(() =>
        decrypt('0'.repeat(32) + ':0123456789abcdef:data', key),
      ).toThrow('Invalid auth tag length');
    });

    it('throws for tampered ciphertext', () => {
      const key = deriveKey(masterKey, workspaceId);
      const encrypted = encrypt('test', key);
      const parts = encrypted.split(':');
      // Tamper with the encrypted data
      const tampered =
        parts[0] + ':' + parts[1] + ':' + 'ff' + parts[2].slice(2);

      expect(() => decrypt(tampered, key)).toThrow();
    });

    it('throws for wrong key', () => {
      const key1 = deriveKey(masterKey, 'ws-1');
      const key2 = deriveKey(masterKey, 'ws-2');
      const encrypted = encrypt('test', key1);

      expect(() => decrypt(encrypted, key2)).toThrow();
    });
  });

  describe('encryptApiKey / decryptApiKey', () => {
    it('encrypts and decrypts API key for workspace', () => {
      const apiKey = 'sk-ant-api03-xxxx-yyyy-zzzz';
      const encrypted = encryptApiKey(apiKey, masterKey, workspaceId);
      const decrypted = decryptApiKey(encrypted, masterKey, workspaceId);

      expect(decrypted).toBe(apiKey);
    });

    it('same API key encrypted for different workspaces produces different ciphertext', () => {
      const apiKey = 'sk-ant-api03-xxxx-yyyy-zzzz';
      const encrypted1 = encryptApiKey(apiKey, masterKey, 'ws-1');
      const encrypted2 = encryptApiKey(apiKey, masterKey, 'ws-2');

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('cannot decrypt with wrong workspace', () => {
      const apiKey = 'sk-ant-api03-xxxx-yyyy-zzzz';
      const encrypted = encryptApiKey(apiKey, masterKey, 'ws-1');

      expect(() => decryptApiKey(encrypted, masterKey, 'ws-2')).toThrow();
    });
  });

  describe('generateId', () => {
    it('returns a valid UUID v4', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('generateToken', () => {
    it('generates a 64-char hex token', () => {
      const { token } = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it('generates a valid SHA-256 hash', () => {
      const { token, hash } = generateToken();
      expect(hash).toHaveLength(64);
      expect(verifyTokenHash(token, hash)).toBe(true);
    });

    it('generates unique tokens', () => {
      const tokens = new Set(
        Array.from({ length: 100 }, () => generateToken().token),
      );
      expect(tokens.size).toBe(100);
    });
  });

  describe('generateApiKeyToken', () => {
    it('generates key with sk_live_ prefix', () => {
      const { key, prefix } = generateApiKeyToken();
      expect(key).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(prefix).toBe(key.substring(0, 15));
    });

    it('generates valid hash', () => {
      const { key, hash } = generateApiKeyToken();
      expect(verifyTokenHash(key, hash)).toBe(true);
    });
  });

  describe('hashToken / verifyTokenHash', () => {
    it('returns true for matching token', () => {
      const { token, hash } = generateToken();
      expect(verifyTokenHash(token, hash)).toBe(true);
    });

    it('returns false for wrong token', () => {
      const { hash } = generateToken();
      expect(verifyTokenHash('wrong-token', hash)).toBe(false);
    });

    it('returns false for invalid hex in stored hash', () => {
      const { token } = generateToken();
      expect(verifyTokenHash(token, 'not-valid-hex')).toBe(false);
    });

    it('hashToken produces consistent output', () => {
      const token = 'test-token';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
    });
  });

  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies password correctly', async () => {
      const password = 'SecurePassword123!';
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await hashPassword('correct');
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('generates different hashes for same password (due to salt)', async () => {
      const password = 'test123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });

    it('hash starts with bcrypt identifier', async () => {
      const hash = await hashPassword('test');
      expect(hash).toMatch(/^\$2[aby]\$/);
    });
  });
});
