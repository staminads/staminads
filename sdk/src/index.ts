/**
 * Staminads SDK v5.0
 * Ultra-reliable web analytics for tracking TimeScore metrics
 *
 * @example
 * ```html
 * <script>
 * window.StaminadsConfig = {
 *   workspace_id: 'ws_abc123',
 *   endpoint: 'https://your-api.com',
 * };
 * </script>
 * <script async src="staminads.min.js"></script>
 * ```
 *
 * Then use the SDK (all methods are async):
 * ```typescript
 * // Track custom dimension
 * await Staminads.setDimension(1, 'premium-user');
 *
 * // Track goal
 * await Staminads.trackGoal({
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
  GoalData,
  SessionDebugInfo,
} from './types';

// Create singleton instance
const sdk = new StaminadsSDK();

// Public API wrapper with both auto-init and manual init support
const Staminads: StaminadsAPI = {
  init: (config: StaminadsConfig) => sdk.init(config),
  getSessionId: () => sdk.getSessionId(),
  getVisitorId: () => sdk.getVisitorId(),
  getConfig: () => sdk.getConfig(),
  getFocusDuration: () => sdk.getFocusDuration(),
  getTotalDuration: () => sdk.getTotalDuration(),
  trackPageView: (url?: string) => sdk.trackPageView(url),
  trackGoal: (data: GoalData) => sdk.trackGoal(data),
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
  GoalData,
  SessionDebugInfo,
};

// Auto-initialize from global config
if (typeof window !== 'undefined' && window.StaminadsConfig) {
  sdk.init(window.StaminadsConfig);
}

// Default export for UMD/ESM/CJS
export default Staminads;
