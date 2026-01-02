import {
  formatSSE,
  createSSEEvent,
  thinkingEvent,
  toolCallEvent,
  toolResultEvent,
  configEvent,
  errorEvent,
  doneEvent,
  usageEvent,
  SSEEvent,
} from './sse-formatter';

describe('sse-formatter', () => {
  describe('formatSSE', () => {
    it('formats event with correct SSE structure', () => {
      const event: SSEEvent = {
        type: 'thinking',
        data: { text: 'Hello' },
        timestamp: 1234567890,
      };

      const result = formatSSE(event);

      expect(result).toBe(
        'event: thinking\ndata: {"text":"Hello"}\n\n',
      );
    });

    it('properly escapes JSON data', () => {
      const event: SSEEvent = {
        type: 'thinking',
        data: { text: 'Line1\nLine2' },
        timestamp: 1234567890,
      };

      const result = formatSSE(event);

      expect(result).toContain('"Line1\\nLine2"');
    });
  });

  describe('createSSEEvent', () => {
    it('creates event with type, data, and timestamp', () => {
      const before = Date.now();
      const event = createSSEEvent('thinking', { message: 'test' });
      const after = Date.now();

      expect(event.type).toBe('thinking');
      expect(event.data).toEqual({ message: 'test' });
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('thinkingEvent', () => {
    it('creates thinking event with text', () => {
      const event = thinkingEvent('Processing your request...');

      expect(event.type).toBe('thinking');
      expect(event.data).toEqual({ text: 'Processing your request...' });
    });
  });

  describe('toolCallEvent', () => {
    it('creates tool_call event with name and input', () => {
      const input = { dimension: 'country', limit: 10 };
      const event = toolCallEvent('get_dimension_values', input);

      expect(event.type).toBe('tool_call');
      expect(event.data).toEqual({
        name: 'get_dimension_values',
        input,
      });
    });
  });

  describe('toolResultEvent', () => {
    it('creates tool_result event with name and result', () => {
      const result = { values: ['US', 'UK', 'CA'] };
      const event = toolResultEvent('get_dimension_values', result);

      expect(event.type).toBe('tool_result');
      expect(event.data).toEqual({
        name: 'get_dimension_values',
        result,
      });
    });
  });

  describe('configEvent', () => {
    it('creates config event with configuration object', () => {
      const config = {
        dimensions: ['country', 'device'],
        period: 'last_7_days',
      };
      const event = configEvent(config);

      expect(event.type).toBe('config');
      expect(event.data).toEqual(config);
    });
  });

  describe('errorEvent', () => {
    it('creates error event with code and message', () => {
      const event = errorEvent('RATE_LIMIT', 'Too many requests');

      expect(event.type).toBe('error');
      expect(event.data).toEqual({
        code: 'RATE_LIMIT',
        message: 'Too many requests',
        retry_after: undefined,
      });
    });

    it('includes retry_after when provided', () => {
      const event = errorEvent('RATE_LIMIT', 'Too many requests', 3600);

      expect(event.type).toBe('error');
      expect(event.data).toEqual({
        code: 'RATE_LIMIT',
        message: 'Too many requests',
        retry_after: 3600,
      });
    });
  });

  describe('doneEvent', () => {
    it('creates done event with completion message', () => {
      const event = doneEvent();

      expect(event.type).toBe('done');
      expect(event.data).toEqual({ message: 'Stream complete' });
    });
  });

  describe('usageEvent', () => {
    it('creates usage event with token counts and cost', () => {
      const event = usageEvent(1000, 500, 0.015);

      expect(event.type).toBe('usage');
      expect(event.data).toEqual({
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.015,
      });
    });
  });
});
