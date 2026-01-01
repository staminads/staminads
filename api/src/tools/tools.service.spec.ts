import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ToolsService } from './tools.service';

describe('ToolsService', () => {
  let service: ToolsService;
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
  };

  beforeEach(async () => {
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
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
  });

  describe('getFavicon', () => {
    const FALLBACK_PNG_SIZE = 68; // 1x1 transparent PNG

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
      mockCacheManager.get.mockResolvedValue(null);

      // Use Google favicon service which should be reliable
      await service.getFavicon('https://www.google.com/favicon.ico');

      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    it('handles direct image URLs', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      const result = await service.getFavicon(
        'https://www.google.com/favicon.ico',
      );

      expect(result.buffer.length).toBeGreaterThan(0);
      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    it('returns fallback for unreachable URLs', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      const result = await service.getFavicon(
        'https://this-domain-does-not-exist-12345.com',
      );

      // Should fall back to Google favicon service or fallback image
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.contentType).toMatch(/^image\//);
    });
  });

  describe('getWebsiteMeta', () => {
    it('extracts title from page', async () => {
      const result = await service.getWebsiteMeta('https://www.google.com');

      expect(result.title).toBeDefined();
      expect(typeof result.title).toBe('string');
    });

    it('throws for non-existent URL', async () => {
      await expect(
        service.getWebsiteMeta('https://this-domain-does-not-exist-12345.com'),
      ).rejects.toThrow();
    });
  });
});
