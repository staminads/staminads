/**
 * Offline/Online Transition Integration Tests
 *
 * Tests that events are properly queued when offline and
 * flushed when coming back online or on visibility change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage, STORAGE_KEYS } from '../../src/storage/storage';
import { Sender } from '../../src/transport/sender';
import type { TrackEventPayload, QueuedPayload } from '../../src/types';

// Mock UUID generation
vi.mock('../../src/utils/uuid', () => ({
  generateUUIDv4: vi.fn(() => 'mock-queue-id-' + Math.random().toString(36).slice(2, 10)),
}));

describe('Offline/Online Integration', () => {
  let storage: Storage;
  let sender: Sender;
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
    duration: 10,
    created_at: 1705320000000,  // 2024-01-15T12:00:00.000Z
    updated_at: 1705320000000,
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
    vi.stubGlobal('navigator', {
      sendBeacon: mockSendBeacon,
      onLine: true,
    });

    storage = new Storage();
    sender = new Sender('https://api.example.com', storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('queuing when offline', () => {
    it('queues events when all send methods fail', async () => {
      // Simulate offline - all methods fail
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const payload = createPayload();
      await sender.send(payload);

      // Verify event was queued
      const queue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(queue.length).toBe(1);
      expect(queue[0].payload.session_id).toBe('session_456');
    });

    it('preserves payload integrity when queued', async () => {
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const originalPayload = createPayload({
        name: 'screen_view',
        duration: 42,
        max_scroll: 75,
        stm_1: 'custom-value',
      });

      await sender.send(originalPayload);

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      const queuedPayload = queue[0].payload;

      // Verify all fields are preserved
      expect(queuedPayload.name).toBe('screen_view');
      expect(queuedPayload.duration).toBe(42);
      expect(queuedPayload.max_scroll).toBe(75);
      expect(queuedPayload.stm_1).toBe('custom-value');
    });

    it('sets sent_at timestamp at transmission time', async () => {
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const originalPayload = createPayload();
      // Note: sent_at is not set in payload - sender sets it at transmission time

      await sender.send(originalPayload);

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      const queuedPayload = queue[0].payload;

      // sent_at should be set by sender at transmission time (Date.now() = 1705320000000)
      expect(queuedPayload.sent_at).toBe(1705320000000);
    });

    it('multiple failed events queue in order', async () => {
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Send 3 events
      for (let i = 1; i <= 3; i++) {
        const payload = createPayload({ path: `/page-${i}` });
        await sender.send(payload);
      }

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(queue.length).toBe(3);
      expect(queue[0].payload.path).toBe('/page-1');
      expect(queue[1].payload.path).toBe('/page-2');
      expect(queue[2].payload.path).toBe('/page-3');
    });
  });

  describe('flushing queue on online', () => {
    it('flushQueue resets sent_at to current time on retry', async () => {
      // Pre-fill queue with items that have old sent_at
      const oldSentAt1 = Date.now() - 5000; // 5 seconds ago
      const oldSentAt2 = Date.now() - 3000; // 3 seconds ago
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload({ path: '/page-1', sent_at: oldSentAt1 }),
          created_at: Date.now() - 5000,
          attempts: 0,
          last_attempt: null,
        },
        {
          id: 'item-2',
          payload: createPayload({ path: '/page-2', sent_at: oldSentAt2 }),
          created_at: Date.now() - 3000,
          attempts: 0,
          last_attempt: null,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      await sender.flushQueue();

      // Verify sent_at is reset to NOW (current time) on retry, not preserved
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body);

      // Both should have sent_at = Date.now() (1705320000000 in fake timers)
      expect(call1Body.sent_at).toBe(Date.now());
      expect(call2Body.sent_at).toBe(Date.now());
    });

    it('flushQueue sends all queued items when back online', async () => {
      // Pre-fill queue with items
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload({ path: '/page-1' }),
          created_at: Date.now() - 1000,
          attempts: 0,
          last_attempt: null,
        },
        {
          id: 'item-2',
          payload: createPayload({ path: '/page-2' }),
          created_at: Date.now() - 500,
          attempts: 0,
          last_attempt: null,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      // Re-initialize sender to pick up queue
      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      // Now we're "online" - fetch succeeds
      mockSendBeacon.mockReturnValue(false); // Force fetch path
      mockFetch.mockResolvedValue({ ok: true });

      await sender.flushQueue();

      // Both items should have been sent
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Queue should be empty
      const remainingQueue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(remainingQueue.length).toBe(0);
    });

    it('removes successfully sent items from queue', async () => {
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload({ path: '/page-1' }),
          created_at: Date.now() - 1000,
          attempts: 0,
          last_attempt: null,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      await sender.flushQueue();

      const queue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(queue.length).toBe(0);
    });

    it('keeps failed items in queue during flush', async () => {
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload({ path: '/page-1' }),
          created_at: Date.now() - 1000,
          attempts: 0,
          last_attempt: null,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      // Still failing
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: false });

      await sender.flushQueue();

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(queue.length).toBe(1);
      expect(queue[0].attempts).toBe(1); // Attempt count incremented
    });
  });

  describe('exponential backoff', () => {
    it('respects backoff timing between retries', async () => {
      // Item with 2 previous attempts, last attempt 1 second ago
      // Backoff for attempt 2 = min(1000 * 2^2, 30000) = 4000ms
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload(),
          created_at: Date.now() - 10000,
          attempts: 2,
          last_attempt: Date.now() - 1000, // 1 second ago, but needs 4s backoff
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      await sender.flushQueue();

      // Should NOT have tried to send (backoff not elapsed)
      expect(mockFetch).not.toHaveBeenCalled();

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(queue[0].attempts).toBe(2); // Not incremented
    });

    it('sends when backoff time has elapsed', async () => {
      // Item with 1 previous attempt, last attempt 3 seconds ago
      // Backoff for attempt 1 = min(1000 * 2^1, 30000) = 2000ms
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload(),
          created_at: Date.now() - 10000,
          attempts: 1,
          last_attempt: Date.now() - 3000, // 3 seconds ago, backoff is 2s
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      await sender.flushQueue();

      // Should have sent
      expect(mockFetch).toHaveBeenCalled();
    });

    it('drops items after max retry attempts (5)', async () => {
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload(),
          created_at: Date.now() - 1000,
          attempts: 5, // Max attempts reached
          last_attempt: Date.now() - 60000,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      // Item should be dropped, not retried
      expect(mockFetch).not.toHaveBeenCalled();

      const queue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(queue.length).toBe(0);
    });

    it('drops items older than 24 hours', async () => {
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload(),
          created_at: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
          attempts: 0,
          last_attempt: null,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      await sender.flushQueue();

      // Item should be dropped, not sent
      expect(mockFetch).not.toHaveBeenCalled();

      const queue = JSON.parse(mockLocalStorage._store['stm_pending'] || '[]');
      expect(queue.length).toBe(0);
    });
  });

  describe('queue size limits', () => {
    it('limits queue to 50 items, removing oldest first', async () => {
      // Pre-fill queue with 50 items
      const existingQueue: QueuedPayload[] = [];
      for (let i = 0; i < 50; i++) {
        existingQueue.push({
          id: `item-${i}`,
          payload: createPayload({ path: `/page-${i}` }),
          created_at: Date.now() - (50 - i) * 1000,
          attempts: 0,
          last_attempt: null,
        });
      }
      mockLocalStorage._store['stm_pending'] = JSON.stringify(existingQueue);

      // Force all sends to fail to trigger queue
      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('fail'));

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      // Try to add 51st item
      const newPayload = createPayload({ path: '/page-new' });
      await sender.send(newPayload);

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(queue.length).toBe(50);
      // First item should have been removed
      expect(queue[0].id).toBe('item-1');
      // New item should be at the end
      expect(queue[49].payload.path).toBe('/page-new');
    });
  });

  describe('mixed success/failure during flush', () => {
    it('handles partial success - keeps only failed items', async () => {
      const queuedItems: QueuedPayload[] = [
        {
          id: 'item-1',
          payload: createPayload({ path: '/page-1' }),
          created_at: Date.now() - 1000,
          attempts: 0,
          last_attempt: null,
        },
        {
          id: 'item-2',
          payload: createPayload({ path: '/page-2' }),
          created_at: Date.now() - 500,
          attempts: 0,
          last_attempt: null,
        },
      ];
      mockLocalStorage._store['stm_pending'] = JSON.stringify(queuedItems);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      mockSendBeacon.mockReturnValue(false);
      // First call succeeds, second fails
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false });

      await sender.flushQueue();

      const queue = JSON.parse(mockLocalStorage._store['stm_pending']);
      expect(queue.length).toBe(1);
      expect(queue[0].id).toBe('item-2'); // Only failed item remains
    });
  });
});
