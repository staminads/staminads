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
 * // Track custom dimension programmatically
 * await Staminads.setDimension(1, 'premium-user');
 *
 * // Track goal
 * await Staminads.trackGoal({
 *   action: 'purchase',
 *   value: 99.99,
 *   currency: 'USD',
 * });
 * ```
 *
 * Custom dimensions can also be set via URL parameters:
 * ```
 * https://example.com/page?stm_1=campaign_a&stm_2=variant_b
 * ```
 * URL parameters stm_1 through stm_10 are automatically captured on init.
 * Existing dimension values take priority over URL parameters.
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
  getConfig: () => sdk.getConfig(),
  getFocusDuration: () => sdk.getFocusDuration(),
  getTotalDuration: () => sdk.getTotalDuration(),
  trackPageView: (url?: string) => sdk.trackPageView(url),
  trackGoal: (data: GoalData) => sdk.trackGoal(data),
  setDimension: (index: number, value: string) => sdk.setDimension(index, value),
  setDimensions: (dimensions: Record<number, string>) => sdk.setDimensions(dimensions),
  getDimension: (index: number) => sdk.getDimension(index),
  clearDimensions: () => sdk.clearDimensions(),
  setUserId: (id: string | null) => sdk.setUserId(id),
  getUserId: () => sdk.getUserId(),
  pause: () => sdk.pause(),
  resume: () => sdk.resume(),
  reset: () => sdk.reset(),
  debug: (): SessionDebugInfo => sdk.debug(),
  decorateUrl: (url: string) => sdk.decorateUrl(url),
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
