/**
 * Tests for V3 Sender
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sender } from './sender';
import { Storage } from '../storage/storage';
import type { SessionPayload } from '../types/session-state';

describe('Sender V3', () => {
  let sender: Sender;
  let mockStorage: Storage;
  let mockLocalStorage: ReturnType<typeof createMockStorage>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let sendBeaconMock: ReturnType<typeof vi.fn>;

  const createMockStorage = () => {
    const store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(),
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
      get length() {
        return Object.keys(store).length;
      },
      _store: store,
    };
  };

  const createPayload = (): SessionPayload => ({
    workspace_id: 'ws-123',
    session_id: 'session-123',
    actions: [
      {
        type: 'pageview',
        path: '/home',
        page_number: 1,
        duration: 5000,
        scroll: 50,
        entered_at: Date.now() - 5000,
        exited_at: Date.now(),
      },
    ],
    created_at: Date.now() - 60000,
    updated_at: Date.now(),
    sdk_version: '6.0.0',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    mockLocalStorage = createMockStorage();
    vi.stubGlobal('localStorage', mockLocalStorage);

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, checkpoint: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    sendBeaconMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock });

    mockStorage = new Storage();
    sender = new Sender('https://api.example.com', mockStorage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('sendSession', () => {
    it('sends payload via fetch to correct endpoint', async () => {
      const payload = createPayload();
      await sender.sendSession(payload);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        })
      );
    });

    it('returns success with checkpoint on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, checkpoint: 5 }),
      });

      const result = await sender.sendSession(createPayload());

      expect(result.success).toBe(true);
      expect(result.checkpoint).toBe(5);
    });

    it('returns error on HTTP failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await sender.sendSession(createPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 500: Internal Server Error');
    });

    it('returns error on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const result = await sender.sendSession(createPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('returns error on unknown error', async () => {
      fetchMock.mockRejectedValue('unknown');

      const result = await sender.sendSession(createPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('sendSessionBeacon', () => {
    it('sends payload via sendBeacon', () => {
      const payload = createPayload();
      const result = sender.sendSessionBeacon(payload);

      expect(result).toBe(true);
      expect(sendBeaconMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.any(Blob)
      );
    });

    it('creates Blob with application/json type', () => {
      const payload = createPayload();
      sender.sendSessionBeacon(payload);

      const blobArg = sendBeaconMock.mock.calls[0][1] as Blob;
      expect(blobArg.type).toBe('application/json');
    });

    it('falls back to fetch when sendBeacon fails', () => {
      sendBeaconMock.mockReturnValue(false);

      const payload = createPayload();
      const result = sender.sendSessionBeacon(payload);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.objectContaining({
          method: 'POST',
          keepalive: true,
        })
      );
    });

    it('falls back to fetch when sendBeacon throws', () => {
      sendBeaconMock.mockImplementation(() => {
        throw new Error('Beacon error');
      });

      const payload = createPayload();
      const result = sender.sendSessionBeacon(payload);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('returns false when both sendBeacon and fetch fail', () => {
      sendBeaconMock.mockReturnValue(false);
      fetchMock.mockImplementation(() => {
        throw new Error('Fetch error');
      });

      const payload = createPayload();
      const result = sender.sendSessionBeacon(payload);

      expect(result).toBe(false);
    });

    it('works when sendBeacon is not available', () => {
      vi.stubGlobal('navigator', { sendBeacon: undefined });

      const payload = createPayload();
      const result = sender.sendSessionBeacon(payload);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('skips sendBeacon for payloads > 15KB and uses fetch directly', () => {
      // Create a payload larger than 15KB
      const largePayload = createPayload();
      largePayload.attributes = {
        landing_page: 'https://example.com',
        user_agent: 'x'.repeat(16 * 1024), // 16KB string
      };

      const result = sender.sendSessionBeacon(largePayload);

      // Should NOT call sendBeacon for large payloads
      expect(sendBeaconMock).not.toHaveBeenCalled();
      // Should use fetch directly
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.objectContaining({
          method: 'POST',
          keepalive: true,
        })
      );
      expect(result).toBe(true);
    });
  });

  describe('debug mode', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sender = new Sender('https://api.example.com', mockStorage, true);
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('logs sendSession payload in debug mode', async () => {
      await sender.sendSession(createPayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Staminads] Sending session payload:',
        expect.any(Object)
      );
    });

    it('logs sendSession response in debug mode', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, checkpoint: 3 }),
      });

      await sender.sendSession(createPayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Staminads] Session response:',
        { success: true, checkpoint: 3 }
      );
    });

    it('logs errors in debug mode', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      await sender.sendSession(createPayload());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Staminads] Send failed:',
        expect.any(Error)
      );
    });

    it('logs beacon send in debug mode', () => {
      sender.sendSessionBeacon(createPayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Staminads] Sending session beacon:',
        expect.any(Object)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Staminads] Session sent via beacon'
      );
    });

    it('logs fetch fallback in debug mode', () => {
      sendBeaconMock.mockReturnValue(false);

      sender.sendSessionBeacon(createPayload());

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Staminads] Session sent via fetch keepalive'
      );
    });
  });
});
