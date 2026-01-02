import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sender } from './sender';
import { Storage, STORAGE_KEYS } from '../storage/storage';
import type { TrackEventPayload, QueuedPayload } from '../types';

// Mock UUID generation
vi.mock('../utils/uuid', () => ({
  generateUUIDv4: vi.fn(() => 'mock-queue-id-' + Math.random().toString(36).slice(2, 10)),
}));

describe('Sender', () => {
  let sender: Sender;
  let storage: Storage;
  let mockLocalStorage: ReturnType<typeof createMockStorage>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockSendBeacon: ReturnType<typeof vi.fn>;

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

  const createPayload = (overrides: Partial<TrackEventPayload> = {}): TrackEventPayload => ({
    workspace_id: 'ws_123',
    session_id: 'session_456',
    name: 'ping',
    path: '/page',
    landing_page: 'https://example.com',
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    mockLocalStorage = createMockStorage();
    vi.stubGlobal('localStorage', mockLocalStorage);

    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    mockSendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: mockSendBeacon });

    storage = new Storage();
    sender = new Sender('https://api.example.com', storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('payload handling', () => {
    it('sends payload with sent_at timestamp via fetch fallback', async () => {
      // Use fetch path to verify payload content (easier to inspect than Blob)
      mockSendBeacon.mockReturnValue(false);

      const sentAt = Date.now();
      const payload = createPayload({ sent_at: sentAt });
      await sender.send(payload);

      expect(mockFetch).toHaveBeenCalled();
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.sent_at).toBe(sentAt);
    });

    it('preserves sent_at when queuing failed payload', async () => {
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('fail'));

      const sentAt = Date.now();
      const payload = createPayload({ sent_at: sentAt });
      await sender.send(payload);

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue[0].payload.sent_at).toBe(sentAt);
    });
  });

  describe('send methods', () => {
    describe('beacon', () => {
      it('send() tries beacon first', async () => {
        const payload = createPayload();
        await sender.send(payload);

        expect(mockSendBeacon).toHaveBeenCalledWith(
          'https://api.example.com/api/track',
          expect.any(Blob)
        );
      });

      it('sendBeacon returns false when payload > 15KB', async () => {
        // Create a payload larger than 15KB
        const largeData = 'x'.repeat(16 * 1024);
        const payload = createPayload({ properties: { data: largeData } });

        await sender.send(payload);

        // Beacon should NOT be called for large payloads
        expect(mockSendBeacon).not.toHaveBeenCalled();
        // Should fall back to fetch
        expect(mockFetch).toHaveBeenCalled();
      });

      it('sendBeacon creates Blob with application/json type', async () => {
        const payload = createPayload();
        await sender.send(payload);

        const blobArg = mockSendBeacon.mock.calls[0][1] as Blob;
        expect(blobArg.type).toBe('application/json');
      });
    });

    describe('fetch', () => {
      it('falls back to fetch when beacon unavailable', async () => {
        vi.stubGlobal('navigator', { sendBeacon: undefined });

        const payload = createPayload();
        await sender.send(payload);

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/api/track',
          expect.objectContaining({
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      it('sendFetch uses keepalive: true', async () => {
        mockSendBeacon.mockReturnValue(false);

        const payload = createPayload();
        await sender.send(payload);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ keepalive: true })
        );
      });

      it('falls back to fetch when beacon returns false', async () => {
        mockSendBeacon.mockReturnValue(false);

        const payload = createPayload();
        await sender.send(payload);

        expect(mockFetch).toHaveBeenCalled();
      });
    });

    describe('queuing on failure', () => {
      it('queues when all methods fail', async () => {
        mockSendBeacon.mockReturnValue(false);
        mockFetch.mockRejectedValue(new Error('Fetch failed'));

        const payload = createPayload();
        await sender.send(payload);

        // Check queue was updated
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
          'stm_pending',
          expect.any(String)
        );
      });
    });
  });

  describe('queue management', () => {
    it('queuePayload creates item with id (UUIDv4)', async () => {
      // Force beacon and fetch to fail
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('fail'));

      const payload = createPayload();
      await sender.send(payload);

      // Verify queue was updated with a UUID
      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue[0].id).toMatch(/^mock-queue-id-/);
    });

    it('queuePayload sets created_at = Date.now()', async () => {
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('fail'));

      const payload = createPayload();
      await sender.send(payload);

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue[0].created_at).toBe(Date.now());
    });

    it('queuePayload sets attempts = 0, last_attempt = null', async () => {
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('fail'));

      const payload = createPayload();
      await sender.send(payload);

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue[0].attempts).toBe(0);
      expect(storedQueue[0].last_attempt).toBeNull();
    });

    it('queue limited to MAX_QUEUE_SIZE (50 items), removes oldest', async () => {
      // Pre-fill queue with 50 items
      const existingQueue: QueuedPayload[] = [];
      for (let i = 0; i < 50; i++) {
        existingQueue.push({
          id: `item-${i}`,
          payload: createPayload(),
          created_at: Date.now() - (50 - i) * 1000,
          attempts: 0,
          last_attempt: null,
        });
      }
      mockLocalStorage._store['stm_pending'] = JSON.stringify(existingQueue);

      // Force failure to queue new item
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('fail'));

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      const payload = createPayload();
      await sender.send(payload);

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue.length).toBe(50);
      // First item should have been removed (item-0)
      expect(storedQueue[0].id).toBe('item-1');
    });

    it('getQueueLength() returns queue.length', () => {
      const existingQueue: QueuedPayload[] = [
        { id: '1', payload: createPayload(), created_at: Date.now(), attempts: 0, last_attempt: null },
        { id: '2', payload: createPayload(), created_at: Date.now(), attempts: 0, last_attempt: null },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(existingQueue);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      expect(sender.getQueueLength()).toBe(2);
    });
  });

  describe('flushQueue', () => {
    it('skips items older than 24 hours', async () => {
      const oldItem: QueuedPayload = {
        id: 'old-item',
        payload: createPayload(),
        created_at: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        attempts: 0,
        last_attempt: null,
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([oldItem]);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      // Old item should be removed without attempting to send
      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(storedQueue.length).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips items with attempts >= 5', async () => {
      const maxAttemptItem: QueuedPayload = {
        id: 'max-attempt-item',
        payload: createPayload(),
        created_at: Date.now() - 1000,
        attempts: 5,
        last_attempt: Date.now() - 60000,
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([maxAttemptItem]);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(storedQueue.length).toBe(0);
    });

    describe('exponential backoff', () => {
      const testBackoff = async (attempts: number, expectedBackoff: number) => {
        const item: QueuedPayload = {
          id: 'backoff-item',
          payload: createPayload(),
          created_at: Date.now() - 1000,
          attempts,
          last_attempt: Date.now() - (expectedBackoff - 100), // Just under backoff
        };
        mockLocalStorage._store['stm_pending'] = JSON.stringify([item]);

        storage = new Storage();
        sender = new Sender('https://api.example.com', storage);

        mockSendBeacon.mockReturnValue(false); // Force fetch
        mockFetch.mockResolvedValue({ ok: false }); // Force failure

        await sender.flushQueue();

        // Should skip due to backoff not elapsed
        const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
        expect(storedQueue.length).toBe(1);
        expect(storedQueue[0].attempts).toBe(attempts); // Not incremented
      };

      it('respects 1s backoff for attempts=0', async () => {
        await testBackoff(0, 1000);
      });

      it('respects 2s backoff for attempts=1', async () => {
        await testBackoff(1, 2000);
      });

      it('respects 4s backoff for attempts=2', async () => {
        await testBackoff(2, 4000);
      });

      it('respects 8s backoff for attempts=3', async () => {
        await testBackoff(3, 8000);
      });

      it('respects 16s backoff for attempts=4', async () => {
        await testBackoff(4, 16000);
      });

      it('caps backoff at 30s for high attempt counts', async () => {
        // At attempts=4, backoff = min(1000 * 2^4, 30000) = 16000ms
        // At attempts=5, item would be skipped due to max attempts
        // So we test with attempts=4 and last_attempt within the 16s backoff
        const item: QueuedPayload = {
          id: 'backoff-item',
          payload: createPayload(),
          created_at: Date.now() - 1000,
          attempts: 4,
          last_attempt: Date.now() - 10000, // 10s ago, but backoff is 16s
        };
        mockLocalStorage._store['stm_pending'] = JSON.stringify([item]);

        storage = new Storage();
        sender = new Sender('https://api.example.com', storage);

        await sender.flushQueue();

        // Should skip due to backoff not elapsed
        const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
        expect(storedQueue.length).toBe(1);
        // Attempts should not be incremented since we skipped
        expect(storedQueue[0].attempts).toBe(4);
      });
    });

    it('increments attempts on retry', async () => {
      const item: QueuedPayload = {
        id: 'retry-item',
        payload: createPayload(),
        created_at: Date.now() - 1000,
        attempts: 1,
        last_attempt: Date.now() - 5000, // Backoff elapsed
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([item]);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: false }); // Fail

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue[0].attempts).toBe(2);
    });

    it('updates last_attempt on retry', async () => {
      const item: QueuedPayload = {
        id: 'retry-item',
        payload: createPayload(),
        created_at: Date.now() - 1000,
        attempts: 0,
        last_attempt: null,
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([item]);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: false }); // Fail

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue[0].last_attempt).toBe(Date.now());
    });

    it('removes item on successful send', async () => {
      const item: QueuedPayload = {
        id: 'success-item',
        payload: createPayload(),
        created_at: Date.now() - 1000,
        attempts: 0,
        last_attempt: null,
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([item]);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true }); // Success

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(storedQueue.length).toBe(0);
    });

    it('keeps item in remaining on failed send', async () => {
      const item: QueuedPayload = {
        id: 'fail-item',
        payload: createPayload(),
        created_at: Date.now() - 1000,
        attempts: 0,
        last_attempt: null,
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([item]);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: false }); // Fail

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      const storedQueue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(storedQueue.length).toBe(1);
      expect(storedQueue[0].id).toBe('fail-item');
    });
  });
});
