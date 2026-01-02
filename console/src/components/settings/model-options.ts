/**
 * Model pricing configuration for Anthropic Claude models.
 * Prices are in USD per million tokens.
 */
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number; display: string; category: 'current' | 'legacy' }
> = {
  'claude-sonnet-4-5-20250929': {
    input: 3,
    output: 15,
    display: 'Claude Sonnet 4.5',
    category: 'current',
  },
  'claude-haiku-4-5-20251001': {
    input: 1,
    output: 5,
    display: 'Claude Haiku 4.5',
    category: 'current',
  },
  'claude-opus-4-5-20251101': {
    input: 15,
    output: 75,
    display: 'Claude Opus 4.5',
    category: 'current',
  },
}
