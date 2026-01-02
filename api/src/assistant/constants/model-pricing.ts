/**
 * Models that support Anthropic structured outputs beta.
 * See: https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs
 */
export const STRUCTURED_OUTPUT_MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001',
];

/**
 * Check if a model supports structured outputs.
 */
export function supportsStructuredOutputs(model: string): boolean {
  return STRUCTURED_OUTPUT_MODELS.includes(model);
}

/**
 * Claude model pricing (USD per million tokens).
 * Update when Anthropic changes pricing.
 */
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number; display: string; category: 'current' | 'legacy' }
> = {
  // Current models (recommended)
  'claude-sonnet-4-5-20250929': {
    input: 3,
    output: 15,
    display: 'Claude Sonnet 4.5',
    category: 'current'
  },
  'claude-haiku-4-5-20251001': {
    input: 1,
    output: 5,
    display: 'Claude Haiku 4.5',
    category: 'current'
  },
  'claude-opus-4-5-20251101': {
    input: 5,
    output: 25,
    display: 'Claude Opus 4.5',
    category: 'current'
  }
}

/**
 * Calculate cost in USD for token usage.
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}
