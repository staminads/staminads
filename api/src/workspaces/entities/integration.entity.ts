/**
 * Integration types for workspace AI and third-party services.
 */

export type IntegrationType = 'anthropic' | 'openai' | 'custom';

/**
 * Base interface for all integrations.
 */
export interface BaseIntegration {
  id: string;
  type: IntegrationType;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Rate limiting configuration for AI integrations.
 */
export interface IntegrationLimits {
  max_requests_per_hour: number;
  max_tokens_per_day: number;
}

/**
 * Usage tracking for AI integrations.
 */
export interface IntegrationUsage {
  requests_this_hour: number;
  tokens_today: number;
  last_reset: string;
}

/**
 * Anthropic Claude integration settings.
 */
export interface AnthropicSettings {
  api_key_encrypted: string;
  model: string;
  max_tokens: number;
  temperature: number;
}

/**
 * Anthropic Claude integration for AI assistant.
 */
export interface AnthropicIntegration extends BaseIntegration {
  type: 'anthropic';
  settings: AnthropicSettings;
  limits: IntegrationLimits;
  usage: IntegrationUsage;
}

/**
 * Union type for all integration types.
 */
export type Integration = AnthropicIntegration;

/**
 * Default limits for new Anthropic integrations.
 */
export const DEFAULT_ANTHROPIC_LIMITS: IntegrationLimits = {
  max_requests_per_hour: 60,
  max_tokens_per_day: 100000,
};

/**
 * Default usage for new integrations.
 */
export const DEFAULT_INTEGRATION_USAGE: IntegrationUsage = {
  requests_this_hour: 0,
  tokens_today: 0,
  last_reset: new Date().toISOString(),
};

/**
 * Default Anthropic model.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
