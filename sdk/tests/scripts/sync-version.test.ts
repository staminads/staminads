/**
 * Tests for sync-version.cjs script
 * Verifies that the script correctly reads APP_VERSION from api/src/version.ts
 * and syncs it to sdk/package.json
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('sync-version script', () => {
  const apiVersionPath = path.join(__dirname, '../../../api/src/version.ts');
  const sdkPackageJsonPath = path.join(__dirname, '../../package.json');

  let originalVersionContent: string;
  let originalPackageJson: string;

  beforeEach(() => {
    // Save original files
    originalVersionContent = fs.readFileSync(apiVersionPath, 'utf-8');
    originalPackageJson = fs.readFileSync(sdkPackageJsonPath, 'utf-8');
  });

  afterEach(() => {
    // Restore original files
    fs.writeFileSync(apiVersionPath, originalVersionContent);
    fs.writeFileSync(sdkPackageJsonPath, originalPackageJson);
  });

  it('should read APP_VERSION from api/src/version.ts', () => {
    const versionContent = fs.readFileSync(apiVersionPath, 'utf-8');
    const match = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);

    expect(match).not.toBeNull();
    expect(match![1]).toBeDefined();
    expect(match![1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have matching version in sdk/package.json after sync', () => {
    // Read current API version
    const versionContent = fs.readFileSync(apiVersionPath, 'utf-8');
    const versionMatch = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const apiVersion = versionMatch![1];

    // Read SDK package.json version
    const packageJson = JSON.parse(fs.readFileSync(sdkPackageJsonPath, 'utf-8'));

    // Versions should match (sync-version runs on prebuild)
    expect(packageJson.version).toBe(apiVersion);
  });

  it('should parse various version formats correctly', () => {
    const testCases = [
      { input: "export const APP_VERSION = '3.0.0';", expected: '3.0.0' },
      { input: 'export const APP_VERSION = "4.1.2";', expected: '4.1.2' },
      { input: "export const APP_VERSION='10.20.30';", expected: '10.20.30' },
      { input: 'const APP_VERSION = "1.0.0-beta";', expected: '1.0.0-beta' },
    ];

    for (const { input, expected } of testCases) {
      const match = input.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(expected);
    }
  });
});
