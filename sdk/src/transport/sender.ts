/**
 * Data transmission with multi-channel fallback
 * Beacon → Fetch+keepalive → XHR → Queue
 */

import type { TrackEventPayload, QueuedPayload } from '../types';
import { Storage, STORAGE_KEYS } from '../storage/storage';
import { generateUUIDv4 } from '../utils/uuid';

// Safari beacon limit is 16KB, use 15KB for safety
const MAX_BEACON_SIZE = 15 * 1024;
const MAX_QUEUE_SIZE = 50;
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RETRY_ATTEMPTS = 5;

export class Sender {
  private endpoint: string;
  private storage: Storage;
  private debug: boolean;

  constructor(endpoint: string, storage: Storage, debug = false) {
    this.endpoint = endpoint;
    this.storage = storage;
    this.debug = debug;
  }

  /**
   * Send event payload
   */
  async send(payload: TrackEventPayload): Promise<boolean> {
    const url = `${this.endpoint}/api/track`;
    const data = JSON.stringify(payload);

    if (this.debug) {
      console.log('[Staminads] Sending:', payload);
    }

    // Try each method in order
    if (await this.sendBeacon(url, data)) {
      return true;
    }

    if (await this.sendFetch(url, data)) {
      return true;
    }

    if (await this.sendXHR(url, data)) {
      return true;
    }

    // All methods failed - queue for retry
    this.queuePayload(payload);
    return false;
  }

  /**
   * Send via Beacon API (survives page unload)
   */
  private sendBeacon(url: string, data: string): boolean {
    if (!navigator.sendBeacon) {
      return false;
    }

    // Check size limit for Safari
    if (data.length > MAX_BEACON_SIZE) {
      if (this.debug) {
        console.warn('[Staminads] Payload too large for beacon:', data.length);
      }
      return false;
    }

    try {
      const blob = new Blob([data], { type: 'application/json' });
      const success = navigator.sendBeacon(url, blob);
      if (this.debug && success) {
        console.log('[Staminads] Sent via beacon');
      }
      return success;
    } catch {
      return false;
    }
  }

  /**
   * Send via Fetch with keepalive (survives page unload)
   */
  private async sendFetch(url: string, data: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      });

      if (response.ok) {
        if (this.debug) {
          console.log('[Staminads] Sent via fetch');
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Send via XHR (98%+ browser support fallback)
   */
  private sendXHR(url: string, data: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (this.debug) {
              console.log('[Staminads] Sent via XHR');
            }
            resolve(true);
          } else {
            resolve(false);
          }
        };

        xhr.onerror = () => resolve(false);
        xhr.ontimeout = () => resolve(false);

        xhr.send(data);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Queue payload for retry
   */
  private queuePayload(payload: TrackEventPayload): void {
    const queue = this.getQueue();

    // Limit queue size
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest
      queue.shift();
    }

    const item: QueuedPayload = {
      id: generateUUIDv4(),
      payload,
      created_at: Date.now(),
      attempts: 0,
      last_attempt: null,
    };

    queue.push(item);
    this.storage.set(STORAGE_KEYS.PENDING_QUEUE, queue);

    if (this.debug) {
      console.log('[Staminads] Queued for retry, queue size:', queue.length);
    }
  }

  /**
   * Get pending queue
   */
  private getQueue(): QueuedPayload[] {
    return this.storage.get<QueuedPayload[]>(STORAGE_KEYS.PENDING_QUEUE) || [];
  }

  /**
   * Flush pending queue
   */
  async flushQueue(): Promise<void> {
    const queue = this.getQueue();
    if (queue.length === 0) return;

    if (this.debug) {
      console.log('[Staminads] Flushing queue, size:', queue.length);
    }

    const remaining: QueuedPayload[] = [];

    for (const item of queue) {
      // Skip if too old
      if (Date.now() - item.created_at > MAX_QUEUE_AGE_MS) {
        continue;
      }

      // Skip if too many attempts
      if (item.attempts >= MAX_RETRY_ATTEMPTS) {
        continue;
      }

      // Exponential backoff
      const backoff = Math.min(1000 * Math.pow(2, item.attempts), 30000);
      if (item.last_attempt && Date.now() - item.last_attempt < backoff) {
        remaining.push(item);
        continue;
      }

      // Try to send
      item.attempts++;
      item.last_attempt = Date.now();

      const url = `${this.endpoint}/api/track`;
      const data = JSON.stringify(item.payload);

      const success =
        (await this.sendFetch(url, data)) || (await this.sendXHR(url, data));

      if (!success) {
        remaining.push(item);
      }
    }

    this.storage.set(STORAGE_KEYS.PENDING_QUEUE, remaining);
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.getQueue().length;
  }
}
