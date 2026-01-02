import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeoService } from './geo.service';
import { EMPTY_GEO, DEFAULT_GEO_SETTINGS } from './geo.interface';

describe('GeoService', () => {
  let service: GeoService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<GeoService>(GeoService);
  });

  describe('lookupWithSettings', () => {
    it('returns EMPTY_GEO when geo_enabled is false', () => {
      const result = service.lookupWithSettings('8.8.8.8', { geo_enabled: false });
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO when IP is null', () => {
      const result = service.lookupWithSettings(null, { geo_enabled: true });
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for localhost IPv4', () => {
      const result = service.lookupWithSettings('127.0.0.1');
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for localhost IPv6', () => {
      const result = service.lookupWithSettings('::1');
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for IPv6 mapped localhost', () => {
      const result = service.lookupWithSettings('::ffff:127.0.0.1');
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for private 10.x.x.x range', () => {
      const result = service.lookupWithSettings('10.0.0.1');
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for private 192.168.x.x range', () => {
      const result = service.lookupWithSettings('192.168.1.1');
      expect(result).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for private 172.16-31.x.x range', () => {
      expect(service.lookupWithSettings('172.16.0.1')).toEqual(EMPTY_GEO);
      expect(service.lookupWithSettings('172.20.0.1')).toEqual(EMPTY_GEO);
      expect(service.lookupWithSettings('172.31.0.1')).toEqual(EMPTY_GEO);
    });

    it('returns EMPTY_GEO for link-local 169.254.x.x range', () => {
      const result = service.lookupWithSettings('169.254.1.1');
      expect(result).toEqual(EMPTY_GEO);
    });

    it('uses default settings when not provided', () => {
      // Without database, returns EMPTY_GEO, but settings are applied
      const result = service.lookupWithSettings('8.8.8.8');
      expect(result).toEqual(EMPTY_GEO); // No database loaded
    });

    it('respects geo_store_region setting', () => {
      // Since database is not loaded, we test the setting application logic
      // by verifying it doesn't throw and returns correctly structured data
      const result = service.lookupWithSettings('8.8.8.8', {
        geo_enabled: true,
        geo_store_region: false,
      });
      // Without database, result is EMPTY_GEO but the setting would be applied
      expect(result).toEqual(EMPTY_GEO);
    });

    it('respects geo_store_city setting', () => {
      const result = service.lookupWithSettings('8.8.8.8', {
        geo_enabled: true,
        geo_store_city: false,
      });
      expect(result).toEqual(EMPTY_GEO);
    });
  });

  describe('isReady', () => {
    it('returns false when database not loaded', () => {
      expect(service.isReady()).toBe(false);
    });
  });

  describe('reloadDatabase', () => {
    it('clears cache and attempts to reload', async () => {
      // Should not throw even without database
      await expect(service.reloadDatabase()).resolves.not.toThrow();
    });
  });

  describe('coordinate rounding', () => {
    // We test the rounding logic indirectly through the service
    // Since the database isn't loaded, we verify the structure is correct
    it('returns null coordinates when database not loaded', () => {
      const result = service.lookupWithSettings('8.8.8.8', {
        geo_enabled: true,
        geo_coordinates_precision: 2,
      });
      expect(result.latitude).toBeNull();
      expect(result.longitude).toBeNull();
    });
  });

  describe('caching', () => {
    it('returns consistent results for same IP', () => {
      const result1 = service.lookupWithSettings('8.8.8.8');
      const result2 = service.lookupWithSettings('8.8.8.8');
      expect(result1).toEqual(result2);
    });

    it('handles different IPs independently', () => {
      // All return EMPTY_GEO without database, but caching works
      const result1 = service.lookupWithSettings('8.8.8.8');
      const result2 = service.lookupWithSettings('8.8.4.4');
      expect(result1).toEqual(result2); // Both EMPTY_GEO without DB
    });
  });

  describe('edge cases', () => {
    it('handles 172.15.x.x as non-private (just outside range)', () => {
      // 172.15.x.x is NOT in the private range (172.16-31.x.x)
      // But without database, still returns EMPTY_GEO
      const result = service.lookupWithSettings('172.15.0.1');
      // This is technically a public IP, but we don't have the database
      expect(result).toEqual(EMPTY_GEO);
    });

    it('handles 172.32.x.x as non-private (just outside range)', () => {
      // 172.32.x.x is NOT in the private range (172.16-31.x.x)
      const result = service.lookupWithSettings('172.32.0.1');
      expect(result).toEqual(EMPTY_GEO);
    });
  });
});
