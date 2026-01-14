import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { StaminadsConfig } from './types';

describe('Staminads SDK - Global Config Pattern', () => {
  // Store original window.StaminadsConfig
  let originalConfig: StaminadsConfig | undefined;

  beforeEach(() => {
    // Save original
    originalConfig = window.StaminadsConfig;
    // Reset modules to allow fresh import
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original
    if (originalConfig !== undefined) {
      window.StaminadsConfig = originalConfig;
    } else {
      delete window.StaminadsConfig;
    }
    vi.resetModules();
  });

  describe('initialization', () => {
    it('should auto-initialize from window.StaminadsConfig', async () => {
      // Set global config before SDK loads
      window.StaminadsConfig = {
        workspace_id: 'test-ws',
        endpoint: 'https://test.com',
      };

      // Dynamically import the SDK
      const { default: Staminads } = await import('./index');

      // Verify SDK exports the API
      expect(typeof Staminads.trackGoal).toBe('function');
      expect(typeof Staminads.getSessionId).toBe('function');
      expect(typeof Staminads.debug).toBe('function');
    });

    it('should handle missing config gracefully on import', async () => {
      // No config set
      delete window.StaminadsConfig;

      // Should not throw on import
      const { default: Staminads } = await import('./index');

      expect(typeof Staminads.trackGoal).toBe('function');
    });

    it('should have init method on public API', async () => {
      window.StaminadsConfig = {
        workspace_id: 'test-ws',
        endpoint: 'https://test.com',
      };

      const { default: Staminads } = await import('./index');

      // init should exist on the public API
      expect(typeof Staminads.init).toBe('function');
    });

    it('init should be idempotent (calling twice returns same promise)', async () => {
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      const config = {
        workspace_id: 'test-ws',
        endpoint: 'https://test.com',
      };

      // Call init twice
      const promise1 = Staminads.init(config);
      const promise2 = Staminads.init(config);

      // Should return the same promise (or both resolve without error)
      await expect(promise1).resolves.toBeUndefined();
      await expect(promise2).resolves.toBeUndefined();

      // Config should be set
      expect(Staminads.getConfig()).not.toBeNull();
      expect(Staminads.getConfig()?.workspace_id).toBe('test-ws');
    });
  });

  describe('error handling', () => {
    it('should throw when calling methods without config', async () => {
      // No config set
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      // Calling a method should throw
      await expect(Staminads.getSessionId()).rejects.toThrow(
        'Staminads not configured'
      );
    });

    it('should throw for trackGoal without config', async () => {
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      await expect(Staminads.trackGoal({ action: 'test' })).rejects.toThrow(
        'Staminads not configured'
      );
    });

    it('should throw for trackPageView without config', async () => {
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      await expect(Staminads.trackPageView()).rejects.toThrow(
        'Staminads not configured'
      );
    });

    it('should throw for setDimension without config', async () => {
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      await expect(Staminads.setDimension(1, 'test')).rejects.toThrow(
        'Staminads not configured'
      );
    });
  });

  describe('async API', () => {
    it('should return Promise from getSessionId', async () => {
      window.StaminadsConfig = {
        workspace_id: 'test-ws',
        endpoint: 'https://test.com',
      };

      const { default: Staminads } = await import('./index');

      const result = Staminads.getSessionId();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should return Promise from trackGoal', async () => {
      window.StaminadsConfig = {
        workspace_id: 'test-ws',
        endpoint: 'https://test.com',
      };

      const { default: Staminads } = await import('./index');

      const result = Staminads.trackGoal({ action: 'test' });
      expect(result).toBeInstanceOf(Promise);
    });

    it('should return Promise from getDimension', async () => {
      window.StaminadsConfig = {
        workspace_id: 'test-ws',
        endpoint: 'https://test.com',
      };

      const { default: Staminads } = await import('./index');

      const result = Staminads.getDimension(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('sync methods', () => {
    it('getConfig should return null when not initialized', async () => {
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      // getConfig is sync and returns null if not initialized
      expect(Staminads.getConfig()).toBeNull();
    });

    it('debug should return partial info when not initialized', async () => {
      delete window.StaminadsConfig;

      const { default: Staminads } = await import('./index');

      // debug is sync
      const debugInfo = Staminads.debug();
      expect(debugInfo).toBeDefined();
      expect(debugInfo.session).toBeNull();
      expect(debugInfo.config).toBeNull();
    });
  });

  describe('type exports', () => {
    it('should export types correctly', async () => {
      const types = await import('./index');

      // Should export type definitions (they exist at compile time)
      expect(types.default).toBeDefined();
    });
  });

  describe('config validation', () => {
    it('should throw when workspace_id is missing', async () => {
      window.StaminadsConfig = {
        workspace_id: '',
        endpoint: 'https://test.com',
      } as any;

      const { default: Staminads } = await import('./index');

      // The init will fail, so calling a method should throw
      await expect(Staminads.getSessionId()).rejects.toThrow('workspace_id is required');
    });

    it('should throw when endpoint is missing', async () => {
      window.StaminadsConfig = {
        workspace_id: 'test-ws',
        endpoint: '',
      } as any;

      const { default: Staminads } = await import('./index');

      await expect(Staminads.getSessionId()).rejects.toThrow('endpoint is required');
    });
  });
});
