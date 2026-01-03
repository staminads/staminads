import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ToolsService } from './tools.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ToolsService', () => {
  let service: ToolsService;
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
  };

  const FALLBACK_PNG_SIZE = 68; // 1x1 transparent PNG

  // Helper to create mock fetch response
  const createMockResponse = (
    body: string | Buffer,
    options: {
      ok?: boolean;
      status?: number;
      headers?: Record<string, string>;
      contentType?: string;
    } = {},
  ) => {
    const { ok = true, status = 200, headers = {}, contentType = 'text/html' } = options;
    const allHeaders = { 'content-type': contentType, ...headers };

    return Promise.resolve({
      ok,
      status,
      headers: {
        get: (name: string) => (allHeaders as Record<string, string>)[name.toLowerCase()] || null,
      },
      text: () => Promise.resolve(typeof body === 'string' ? body : body.toString()),
      json: () => Promise.resolve(JSON.parse(typeof body === 'string' ? body : body.toString())),
      arrayBuffer: () => Promise.resolve(Buffer.isBuffer(body) ? body : Buffer.from(body)),
    });
  };

  beforeEach(async () => {
    mockCacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolsService,
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<ToolsService>(ToolsService);
    mockFetch.mockReset();
  });

  describe('getFavicon', () => {
    it('returns fallback for invalid URL', async () => {
      const result = await service.getFavicon('not-a-url');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.length).toBe(FALLBACK_PNG_SIZE);
    });

    it('returns fallback for non-http URL', async () => {
      const result = await service.getFavicon('ftp://example.com');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.length).toBe(FALLBACK_PNG_SIZE);
    });

    it('returns cached result when available', async () => {
      const cachedResult = {
        buffer: Buffer.from('cached-image'),
        contentType: 'image/png',
      };
      mockCacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.getFavicon('https://example.com');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.toString()).toBe('cached-image');
      expect(mockCacheManager.get).toHaveBeenCalled();
    });

    it('caches successful favicon fetch', async () => {
      const smallPng = Buffer.alloc(100); // Small image, won't be resized
      mockFetch.mockResolvedValue(
        createMockResponse(smallPng, { contentType: 'image/png' }),
      );

      await service.getFavicon('https://example.com/favicon.png');

      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    it('handles direct image URLs (.ico)', async () => {
      const icoData = Buffer.alloc(100);
      mockFetch.mockResolvedValue(
        createMockResponse(icoData, { contentType: 'image/x-icon' }),
      );

      const result = await service.getFavicon('https://example.com/favicon.ico');

      expect(result.contentType).toBe('image/x-icon');
      expect(result.buffer.length).toBe(100);
    });

    it('handles direct image URLs (.svg)', async () => {
      const svgData = Buffer.from('<svg></svg>');
      mockFetch.mockResolvedValue(
        createMockResponse(svgData, { contentType: 'image/svg+xml' }),
      );

      const result = await service.getFavicon('https://example.com/icon.svg');

      expect(result.contentType).toBe('image/svg+xml');
    });

    it('returns fallback for fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await service.getFavicon('https://example.com/favicon.png');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.length).toBe(FALLBACK_PNG_SIZE);
    });

    it('returns fallback when image fetch returns not ok', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse('Not Found', { ok: false, status: 404 }),
      );

      const result = await service.getFavicon('https://example.com/favicon.png');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.length).toBe(FALLBACK_PNG_SIZE);
    });

    it('returns fallback when content-length exceeds max size', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(Buffer.alloc(10), {
          contentType: 'image/png',
          headers: { 'content-length': '2000000' }, // 2MB > 1MB limit
        }),
      );

      const result = await service.getFavicon('https://example.com/favicon.png');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.length).toBe(FALLBACK_PNG_SIZE);
    });

    it('extracts favicon from page with apple-touch-icon', async () => {
      // First call: page HTML with apple-touch-icon
      const html = `
        <html>
          <head>
            <link rel="apple-touch-icon" href="/apple-icon.png">
          </head>
        </html>
      `;
      // Second call: the actual icon
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/png' }));

      const result = await service.getFavicon('https://example.com');

      expect(result.buffer.length).toBe(100);
    });

    it('extracts favicon from page with sized icon links', async () => {
      const html = `
        <html>
          <head>
            <link rel="icon" sizes="16x16" href="/icon-16.png">
            <link rel="icon" sizes="32x32" href="/icon-32.png">
            <link rel="icon" sizes="64x64" href="/icon-64.png">
          </head>
        </html>
      `;
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/png' }));

      const result = await service.getFavicon('https://example.com');

      // Should pick the largest icon (64x64)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('icon-64.png'),
        expect.any(Object),
      );
    });

    it('extracts favicon from page with regular icon', async () => {
      const html = `
        <html>
          <head>
            <link rel="icon" href="/favicon.ico">
          </head>
        </html>
      `;
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/x-icon' }));

      const result = await service.getFavicon('https://example.com');

      expect(result.buffer.length).toBe(100);
    });

    it('extracts favicon from page with shortcut icon', async () => {
      const html = `
        <html>
          <head>
            <link rel="shortcut icon" href="/shortcut.ico">
          </head>
        </html>
      `;
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/x-icon' }));

      const result = await service.getFavicon('https://example.com');

      expect(result.buffer.length).toBe(100);
    });

    it('extracts favicon from manifest.json', async () => {
      const html = `
        <html>
          <head>
            <link rel="manifest" href="/manifest.json">
          </head>
        </html>
      `;
      const manifest = JSON.stringify({
        icons: [
          { src: '/icon-192.png', sizes: '192x192' },
          { src: '/icon-512.png', sizes: '512x512' },
        ],
      });
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(manifest, { contentType: 'application/json' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/png' }));

      const result = await service.getFavicon('https://example.com');

      // Should pick the largest icon from manifest
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('icon-512.png'),
        expect.any(Object),
      );
    });

    it('handles manifest with no icons', async () => {
      const html = `
        <html>
          <head>
            <link rel="manifest" href="/manifest.json">
          </head>
        </html>
      `;
      const manifest = JSON.stringify({});

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(manifest, { contentType: 'application/json' }))
        // Fallback to /favicon.ico HEAD request
        .mockResolvedValueOnce(createMockResponse('', { ok: false, status: 404 }))
        // Final fallback to Google favicon service
        .mockResolvedValueOnce(createMockResponse(Buffer.alloc(100), { contentType: 'image/png' }));

      const result = await service.getFavicon('https://example.com');

      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('handles manifest fetch error', async () => {
      const html = `
        <html>
          <head>
            <link rel="manifest" href="/manifest.json">
          </head>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse('', { ok: false, status: 404 }))
        // Fallback to /favicon.ico
        .mockResolvedValueOnce(createMockResponse('', { ok: true }))
        .mockResolvedValueOnce(createMockResponse(Buffer.alloc(100), { contentType: 'image/x-icon' }));

      const result = await service.getFavicon('https://example.com');

      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('falls back to default favicon.ico', async () => {
      const html = '<html><head></head></html>';
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        // HEAD request to /favicon.ico
        .mockResolvedValueOnce(createMockResponse('', { ok: true }))
        // Fetch the favicon.ico
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/x-icon' }));

      const result = await service.getFavicon('https://example.com');

      expect(result.buffer.length).toBe(100);
    });

    it('uses Google favicon service when no favicon found', async () => {
      const html = '<html><head></head></html>';
      const googleFavicon = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        // HEAD request to /favicon.ico fails
        .mockResolvedValueOnce(createMockResponse('', { ok: false, status: 404 }))
        // Google favicon service
        .mockResolvedValueOnce(createMockResponse(googleFavicon, { contentType: 'image/png' }));

      const result = await service.getFavicon('https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('google.com/s2/favicons'),
        expect.any(Object),
      );
    });

    it('handles googleusercontent.com URLs as direct images', async () => {
      const imageData = Buffer.alloc(100);
      mockFetch.mockResolvedValue(
        createMockResponse(imageData, { contentType: 'image/png' }),
      );

      const result = await service.getFavicon(
        'https://lh3.googleusercontent.com/something/photo.jpg',
      );

      expect(result.buffer.length).toBe(100);
      // Should not try to extract favicon from page
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles protocol-relative URLs in icon href', async () => {
      const html = `
        <html>
          <head>
            <link rel="icon" href="//cdn.example.com/icon.png">
          </head>
        </html>
      `;
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/png' }));

      await service.getFavicon('https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cdn.example.com/icon.png',
        expect.any(Object),
      );
    });

    it('handles absolute URLs in icon href', async () => {
      const html = `
        <html>
          <head>
            <link rel="icon" href="https://cdn.example.com/icon.png">
          </head>
        </html>
      `;
      const iconData = Buffer.alloc(100);

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html, { contentType: 'text/html' }))
        .mockResolvedValueOnce(createMockResponse(iconData, { contentType: 'image/png' }));

      await service.getFavicon('https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cdn.example.com/icon.png',
        expect.any(Object),
      );
    });

    it('handles empty buffer from fetch', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(Buffer.alloc(0), { contentType: 'image/png' }),
      );

      const result = await service.getFavicon('https://example.com/favicon.png');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer.length).toBe(FALLBACK_PNG_SIZE);
    });
  });

  describe('getWebsiteMeta', () => {
    it('extracts title from og:title', async () => {
      const html = `
        <html>
          <head>
            <meta property="og:title" content="OG Title">
            <title>Page Title</title>
          </head>
        </html>
      `;
      mockFetch.mockResolvedValue(createMockResponse(html));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.title).toBe('OG Title');
    });

    it('falls back to title tag when no og:title', async () => {
      const html = `
        <html>
          <head>
            <title>Page Title</title>
          </head>
        </html>
      `;
      mockFetch.mockResolvedValue(createMockResponse(html));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.title).toBe('Page Title');
    });

    it('returns undefined title when neither og:title nor title exists', async () => {
      const html = '<html><head></head></html>';
      mockFetch.mockResolvedValue(createMockResponse(html));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.title).toBeUndefined();
    });

    it('throws for failed fetch', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse('Not Found', { ok: false, status: 404 }),
      );

      await expect(service.getWebsiteMeta('https://example.com')).rejects.toThrow(
        'Failed to fetch URL: 404',
      );
    });

    it('extracts logo from apple-touch-icon', async () => {
      const html = `
        <html>
          <head>
            <link rel="apple-touch-icon" href="/apple-icon.png">
            <title>Test</title>
          </head>
        </html>
      `;
      mockFetch.mockResolvedValue(createMockResponse(html));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.logo_url).toBe('https://example.com/apple-icon.png');
    });

    it('extracts logo from sized icon link', async () => {
      const html = `
        <html>
          <head>
            <link rel="icon" sizes="64x64" href="/icon-64.png">
            <link rel="icon" sizes="32x32" href="/icon-32.png">
          </head>
        </html>
      `;
      mockFetch.mockResolvedValue(createMockResponse(html));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.logo_url).toBe('https://example.com/icon-64.png');
    });

    it('extracts logo from manifest', async () => {
      const html = `
        <html>
          <head>
            <link rel="manifest" href="/manifest.json">
          </head>
        </html>
      `;
      const manifest = JSON.stringify({
        icons: [{ src: '/icon-512.png', sizes: '512x512' }],
      });

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html))
        .mockResolvedValueOnce(createMockResponse(manifest, { contentType: 'application/json' }));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.logo_url).toBe('https://example.com/icon-512.png');
    });

    it('falls back to default favicon.ico', async () => {
      const html = '<html><head></head></html>';

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html))
        // HEAD request to /favicon.ico succeeds
        .mockResolvedValueOnce(createMockResponse('', { ok: true }));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.logo_url).toBe('https://example.com/favicon.ico');
    });

    it('returns undefined logo when no favicon found', async () => {
      const html = '<html><head></head></html>';

      mockFetch
        .mockResolvedValueOnce(createMockResponse(html))
        // HEAD request to /favicon.ico fails
        .mockResolvedValueOnce(createMockResponse('', { ok: false, status: 404 }));

      const result = await service.getWebsiteMeta('https://example.com');

      expect(result.logo_url).toBeUndefined();
    });
  });
});
