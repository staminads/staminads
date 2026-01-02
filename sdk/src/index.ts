/**
 * Staminads SDK v5.0
 * Ultra-reliable web analytics for tracking TimeScore metrics
 *
 * @example
 * ```typescript
 * import Staminads from '@staminads/sdk';
 *
 * Staminads.init({
 *   workspace_id: 'ws_abc123',
 *   endpoint: 'https://your-api.com',
 * });
 *
 * // Track custom dimension
 * Staminads.setDimension(1, 'premium-user');
 *
 * // Track conversion
 * Staminads.trackConversion({
 *   action: 'purchase',
 *   value: 99.99,
 *   currency: 'USD',
 * });
 * ```
 */

import { StaminadsSDK } from './sdk';
import type {
  StaminadsConfig,
  StaminadsAPI,
  ConversionData,
  SessionDebugInfo,
} from './types';

// Create singleton instance
const sdk = new StaminadsSDK();

// Public API wrapper
const Staminads: StaminadsAPI = {
  init: (config: StaminadsConfig) => sdk.init(config),
  getSessionId: () => sdk.getSessionId(),
  getVisitorId: () => sdk.getVisitorId(),
  getConfig: () => sdk.getConfig(),
  getFocusDuration: () => sdk.getFocusDuration(),
  getTotalDuration: () => sdk.getTotalDuration(),
  trackPageView: (url?: string) => sdk.trackPageView(url),
  trackEvent: (name: string, properties?: Record<string, string>) =>
    sdk.trackEvent(name, properties),
  // Alias for trackEvent - convenient shorthand
  track: (name: string, properties?: Record<string, unknown>) =>
    sdk.trackEvent(name, properties as Record<string, string> | undefined),
  trackConversion: (data: ConversionData) => sdk.trackConversion(data),
  // Alias for trackConversion with positional args
  conversion: (action: string, value?: number, currency?: string) =>
    sdk.trackConversion({ action, value, currency }),
  setDimension: (index: number, value: string) => sdk.setDimension(index, value),
  setDimensions: (dimensions: Record<number, string>) => sdk.setDimensions(dimensions),
  getDimension: (index: number) => sdk.getDimension(index),
  clearDimensions: () => sdk.clearDimensions(),
  pause: () => sdk.pause(),
  resume: () => sdk.resume(),
  reset: () => sdk.reset(),
  debug: (): SessionDebugInfo => sdk.debug(),
};

// Export types
export type {
  StaminadsConfig,
  StaminadsAPI,
  ConversionData,
  SessionDebugInfo,
};

// Default export for UMD/ESM/CJS
export default Staminads;
