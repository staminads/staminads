import type { ServerResponse } from 'node:http';
import { setStaticAssetHeaders } from './static-assets';

describe('setStaticAssetHeaders', () => {
  const response = {
    setHeader: jest.fn(),
  } as unknown as ServerResponse;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    '/app/public/sdk/staminads_6.0.0.min.js',
    String.raw`C:\app\public\sdk\staminads_6.2.0.min.js`,
  ])('caches versioned SDK bundles immutably: %s', (filePath) => {
    setStaticAssetHeaders(response, filePath);

    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
  });

  it.each([
    '/app/public/index.html',
    '/app/public/sdk/staminads.min.js',
    '/app/public/sdk/staminads_6.0.0.js',
  ])(
    'does not add immutable caching to non-versioned assets: %s',
    (filePath) => {
      setStaticAssetHeaders(response, filePath);

      expect(response.setHeader).not.toHaveBeenCalled();
    },
  );
});
