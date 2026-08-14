import compression from 'compression';
import type { Request, Response } from 'express';

export function shouldCompress(request: Request, response: Response): boolean {
  const contentType = response.getHeader('Content-Type');

  if (
    typeof contentType === 'string' &&
    contentType.startsWith('text/event-stream')
  ) {
    return false;
  }

  return compression.filter(request, response);
}
