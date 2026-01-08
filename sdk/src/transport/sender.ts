/**
 * V3 Session Payload Transport
 * Handles sending session payloads to the server
 */

import type { SessionPayload, SendResult } from '../types/session-state';
import { Storage } from '../storage/storage';

export class Sender {
  private readonly endpoint: string;
  private readonly debug: boolean;

  constructor(endpoint: string, _storage: Storage, debug: boolean = false) {
    this.endpoint = endpoint;
    this.debug = debug;
  }

  /**
   * Send session payload via fetch
   */
  async sendSession(payload: SessionPayload): Promise<SendResult> {
    const url = `${this.endpoint}/api/track.session`;

    if (this.debug) {
      console.log('[Staminads] Sending session payload:', payload);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();

      if (this.debug) {
        console.log('[Staminads] Session response:', data);
      }

      return {
        success: true,
        checkpoint: data.checkpoint,
      };
    } catch (error) {
      if (this.debug) {
        console.error('[Staminads] Send failed:', error);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send session payload via sendBeacon (for unload)
   */
  sendSessionBeacon(payload: SessionPayload): boolean {
    const url = `${this.endpoint}/api/track.session`;
    const body = JSON.stringify(payload);

    if (this.debug) {
      console.log('[Staminads] Sending session beacon:', payload);
    }

    // Safari beacon limit is 64KB, but older versions had 16KB
    // Use 15KB threshold for safety
    const MAX_BEACON_SIZE = 15 * 1024;
    const useBeacon = body.length <= MAX_BEACON_SIZE;

    // Try sendBeacon first (if payload is small enough)
    if (useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        const success = navigator.sendBeacon(url, blob);
        if (success) {
          if (this.debug) {
            console.log('[Staminads] Session sent via beacon');
          }
          return true;
        }
      } catch {
        // Fall through to fetch fallback
      }
    }

    // Fallback to fetch with keepalive (also used for large payloads)
    try {
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        keepalive: true,
      });
      if (this.debug) {
        console.log('[Staminads] Session sent via fetch keepalive');
      }
      return true;
    } catch {
      return false;
    }
  }
}
