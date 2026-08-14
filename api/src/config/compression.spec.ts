import type { Request, Response } from 'express';
import { shouldCompress } from './compression';

describe('shouldCompress', () => {
  it('does not buffer server-sent events', () => {
    const request = { headers: {} } as Request;
    const response = {
      getHeader: jest.fn().mockReturnValue('text/event-stream; charset=utf-8'),
    } as unknown as Response;

    expect(shouldCompress(request, response)).toBe(false);
  });

  it('compresses JavaScript responses', () => {
    const request = { headers: {} } as Request;
    const response = {
      getHeader: jest.fn((header: string) =>
        header.toLowerCase() === 'content-type'
          ? 'text/javascript; charset=utf-8'
          : undefined,
      ),
    } as unknown as Response;

    expect(shouldCompress(request, response)).toBe(true);
  });
});
