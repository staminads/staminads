# Critical Review: SDK Sender Implementation

> Review by Gemini 3 Pro - January 2025
> Context: Web analytics SDK that must NOT lose any data

**Verdict: Not production-ready. Will lose data in normal operating conditions.**

---

## 1. Data Loss Scenarios (Critical)

### 1.1 No Persistence Layer = Total Data Loss on Failure

```typescript
// Current: Fire and forget - data gone forever on failure
const result = await sender.sendSession(payload);
if (!result.success) {
  // Data is just... lost. Forever.
}
```

**Impact**: Any network failure, server outage, or client-side error results in **permanent data loss**.

**Fix**: Implement a persistent queue:

```typescript
export class PersistentSendQueue {
  private readonly storageKey = 'staminads_send_queue';
  private readonly storage: Storage;

  async enqueue(payload: SessionPayload): Promise<void> {
    const queue = await this.getQueue();
    queue.push({
      payload,
      id: crypto.randomUUID(),
      attempts: 0,
      createdAt: Date.now(),
      nextRetryAt: Date.now(),
    });
    await this.saveQueue(queue);
  }

  async processQueue(): Promise<void> {
    const queue = await this.getQueue();
    const now = Date.now();

    for (const item of queue) {
      if (item.nextRetryAt > now) continue;

      const result = await this.trySend(item.payload);
      if (result.success) {
        await this.removeFromQueue(item.id);
      } else {
        item.attempts++;
        item.nextRetryAt = this.calculateBackoff(item.attempts);
        await this.saveQueue(queue);
      }
    }
  }
}
```

### 1.2 `sendBeacon` Returns `true` But Data Can Still Be Lost

```typescript
const success = navigator.sendBeacon(url, blob);
if (success) {
  return true; // WRONG: This only means "queued", not "delivered"
}
```

**Reality**: `sendBeacon` returning `true` means the browser **accepted** the request for delivery, not that it was delivered. The browser can still drop it if:
- The browser crashes before sending
- The network request fails (no retry)
- The browser's internal queue is full

**You cannot get delivery confirmation with `sendBeacon`**.

### 1.3 `keepalive: true` Has Severe Limitations

```typescript
fetch(url, {
  keepalive: true, // Has a 64KB total limit across ALL keepalive requests
});
```

**Limitations**:
- **64KB total limit** across all concurrent keepalive requests (not per-request)
- If you have multiple tabs, they share this limit
- Silently fails when limit exceeded
- No retry mechanism

---

## 2. Missing Reliability Patterns

### 2.1 No Retry Mechanism

```typescript
// Current: Single attempt, then give up
try {
  const response = await fetch(url, { ... });
} catch (error) {
  return { success: false, error: ... }; // No retry, data lost
}
```

**Production-grade retry with exponential backoff**:

```typescript
export class RetryingSender {
  private readonly maxRetries = 5;
  private readonly baseDelayMs = 1000;
  private readonly maxDelayMs = 30000;

  async sendWithRetry(payload: SessionPayload): Promise<SendResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          this.maxDelayMs
        );
        await this.sleep(delay);
      }

      const result = await this.sendSession(payload);

      if (result.success) {
        return result;
      }

      // Don't retry on 4xx (client errors) - they won't succeed
      if (result.error?.startsWith('HTTP 4')) {
        return result;
      }

      lastError = result.error;
    }

    // All retries exhausted - persist for later
    await this.queue.enqueue(payload);
    return { success: false, error: lastError };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 2.2 No Offline Detection/Handling

```typescript
// Current: Blindly tries to send, even offline
async sendSession(payload: SessionPayload): Promise<SendResult> {
  // No check for navigator.onLine
  // No queuing for when back online
}
```

**Fix**:

```typescript
export class NetworkAwareSender {
  private offlineQueue: SessionPayload[] = [];

  constructor() {
    window.addEventListener('online', () => this.flushOfflineQueue());
  }

  async send(payload: SessionPayload): Promise<SendResult> {
    if (!navigator.onLine) {
      await this.queue.enqueue(payload);
      return { success: false, error: 'offline', queued: true };
    }

    return this.sendWithRetry(payload);
  }

  private async flushOfflineQueue(): Promise<void> {
    // Process queued items when back online
    await this.queue.processQueue();
  }
}
```

### 2.3 No Request Deduplication

If the same payload is retried (e.g., network timeout but server received it), you'll get **duplicate data**.

```typescript
interface QueuedPayload {
  payload: SessionPayload;
  idempotencyKey: string; // Server should reject duplicates
}

// Server-side: Store idempotency keys for 24h, reject duplicates
```

### 2.4 No Circuit Breaker

If the server is down, you'll hammer it with requests, wasting battery and bandwidth:

```typescript
export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly resetTimeMs = 60000;

  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailure > this.resetTimeMs) {
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }

  recordSuccess(): void {
    this.failures = 0;
  }
}
```

---

## 3. Network Edge Cases

### 3.1 Timeout Handling

```typescript
// Current: No timeout - request can hang forever
const response = await fetch(url, { ... });
```

**Fix**:

```typescript
async sendSession(payload: SessionPayload): Promise<SendResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      keepalive: true,
    });

    clearTimeout(timeoutId);
    // ... handle response
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timeout' };
    }
    throw error;
  }
}
```

### 3.2 Mobile Network Switching

When a mobile device switches from WiFi to cellular (or vice versa), in-flight requests fail. Need to detect and retry:

```typescript
// Listen for connection changes
navigator.connection?.addEventListener('change', () => {
  // Network changed - retry any pending requests
  this.queue.processQueue();
});
```

---

## 4. Browser Edge Cases

### 4.1 Back/Forward Cache (bfcache)

Modern browsers aggressively cache pages for back/forward navigation. Events fire differently:

```typescript
// Current approach misses bfcache scenarios
window.addEventListener('beforeunload', ...); // NOT reliable for bfcache

// Proper approach:
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    // Page is being cached - send data but don't clean up state
    this.sendSessionBeacon(payload);
  } else {
    // Page is being destroyed
    this.sendSessionBeacon(payload);
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    // Restored from bfcache - resume session or start new one
    this.resumeSession();
  }
});
```

### 4.2 Page Visibility API (Critical for Mobile)

Mobile browsers heavily throttle/suspend background tabs:

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // CRITICAL: This is often the LAST reliable event on mobile
    // beforeunload/unload may NEVER fire
    this.sendSessionBeacon(this.getCurrentPayload());
  }
});
```

### 4.3 The "Unload" Problem

**`beforeunload` and `unload` are increasingly unreliable**:
- Mobile Safari: Often doesn't fire
- Chrome on Android: Throttled/skipped
- bfcache: Prevents unload from firing

**Best practice for 2025**:

```typescript
export class ReliableUnloadHandler {
  private lastSentPayload: string = '';

  setup(): void {
    // Primary: visibilitychange (most reliable on mobile)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.sendFinalPayload();
      }
    });

    // Secondary: pagehide (bfcache aware)
    window.addEventListener('pagehide', () => {
      this.sendFinalPayload();
    });

    // Fallback: beforeunload (desktop)
    window.addEventListener('beforeunload', () => {
      this.sendFinalPayload();
    });
  }

  private sendFinalPayload(): void {
    const payload = this.getCurrentPayload();
    const payloadStr = JSON.stringify(payload);

    // Prevent duplicate sends from multiple events
    if (payloadStr === this.lastSentPayload) return;
    this.lastSentPayload = payloadStr;

    this.sender.sendSessionBeacon(payload);
  }
}
```

---

## 5. Modern Alternatives (2025)

### 5.1 `fetchLater()` API (Chrome 121+)

**This is the future of reliable analytics**. The browser guarantees delivery:

```typescript
async sendSession(payload: SessionPayload): Promise<SendResult> {
  const url = `${this.endpoint}/api/track`;
  const body = JSON.stringify(payload);

  // Use fetchLater if available (Chrome 121+, Jan 2024)
  if ('fetchLater' in window) {
    try {
      // Browser guarantees this will be sent, even after page close
      const result = (window as any).fetchLater(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        activateAfter: 0, // Send immediately when page is discarded
      });

      return { success: true, deferred: true };
    } catch (error) {
      // Fall through to sendBeacon
    }
  }

  // Fallback to sendBeacon
  return this.sendSessionBeacon(payload);
}
```

### 5.2 Background Sync API (Service Worker)

For offline-first reliability:

```typescript
// In service worker
self.addEventListener('sync', (event) => {
  if (event.tag === 'staminads-sync') {
    event.waitUntil(sendQueuedPayloads());
  }
});

// In main thread
async function queueForBackgroundSync(payload: SessionPayload): Promise<void> {
  // Store in IndexedDB
  await db.payloads.add(payload);

  // Register sync
  const registration = await navigator.serviceWorker.ready;
  await registration.sync.register('staminads-sync');
}
```

### 5.3 Periodic Background Sync

For batching analytics over time:

```typescript
// Service worker
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'staminads-periodic') {
    event.waitUntil(sendQueuedPayloads());
  }
});

// Register (requires permission)
const registration = await navigator.serviceWorker.ready;
await registration.periodicSync.register('staminads-periodic', {
  minInterval: 60 * 60 * 1000, // 1 hour
});
```

---

## 6. Other Issues

### 6.1 Unused Constructor Parameter

```typescript
constructor(endpoint: string, _storage: Storage, debug: boolean = false) {
  // _storage is never used - why is it here?
  this.endpoint = endpoint;
  this.debug = debug;
}
```

Either use it for the persistent queue or remove it.

### 6.2 Debug Logging in Production

```typescript
if (this.debug) {
  console.log('[Staminads] Sending session payload:', payload);
}
```

Logging full payloads can leak sensitive data. Consider:
- Only log in development builds
- Redact sensitive fields
- Use structured logging for observability

### 6.3 No Payload Validation

```typescript
async sendSession(payload: SessionPayload): Promise<SendResult> {
  // No validation that payload is valid/complete
  const response = await fetch(url, {
    body: JSON.stringify(payload), // Could be undefined, circular, too large
  });
}
```

Add validation:

```typescript
private validatePayload(payload: SessionPayload): void {
  if (!payload.sessionId) throw new Error('Missing sessionId');
  if (!payload.workspaceKey) throw new Error('Missing workspaceKey');

  const body = JSON.stringify(payload);
  if (body.length > 1024 * 1024) {
    throw new Error('Payload too large');
  }
}
```

---

## 7. Summary

### Production-Ready Checklist

| Feature | Current | Required |
|---------|:-------:|:--------:|
| Persistent queue (IndexedDB) | No | Yes |
| Retry with exponential backoff | No | Yes |
| Offline detection + queue | No | Yes |
| Request timeout (AbortController) | No | Yes |
| Idempotency/deduplication | No | Yes |
| Circuit breaker | No | Recommended |
| bfcache handling (pagehide) | No | Yes |
| visibilitychange as primary | No | Yes |
| fetchLater() support | No | Recommended |
| Payload validation | No | Yes |

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Sender (2025)                         │
├─────────────────────────────────────────────────────────┤
│  1. Validate payload                                     │
│  2. Check circuit breaker (is server healthy?)          │
│  3. Check navigator.onLine                              │
│  4. If offline → persist to IndexedDB queue             │
│  5. If online → send with timeout + retry               │
│  6. On failure → persist + exponential backoff          │
│  7. On success → update checkpoint, clear from queue    │
├─────────────────────────────────────────────────────────┤
│  Unload Strategy:                                        │
│  - Primary: visibilitychange (hidden)                   │
│  - Secondary: pagehide (bfcache aware)                  │
│  - Tertiary: beforeunload (desktop fallback)            │
│  - Dedupe: track lastSentPayload hash                   │
├─────────────────────────────────────────────────────────┤
│  Modern APIs:                                            │
│  - fetchLater() if available (guaranteed delivery)      │
│  - Background Sync via Service Worker                   │
│  - IndexedDB for persistent queue                       │
└─────────────────────────────────────────────────────────┘
```

**Bottom line**: This implementation will lose data in normal operating conditions. For production analytics, you need at minimum: persistent queuing, retry logic, and proper unload handling. The current code is a prototype, not production-grade.
