import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reader, ReaderModel } from '@maxmind/geoip2-node';
import * as path from 'path';
import * as fs from 'fs';
import {
  GeoLocation,
  GeoSettings,
  EMPTY_GEO,
  DEFAULT_GEO_SETTINGS,
} from './geo.interface';

interface CacheEntry {
  geo: GeoLocation;
  expires: number;
}

@Injectable()
export class GeoService implements OnModuleInit {
  private readonly logger = new Logger(GeoService.name);
  private reader: ReaderModel | null = null;

  /** Cache for raw MaxMind lookups (before settings are applied) */
  private cache = new Map<string, CacheEntry>();

  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly CACHE_MAX_SIZE = 10000;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.loadDatabase();
  }

  /**
   * Get the path to the MaxMind database.
   */
  private getDbPath(): string {
    return (
      this.configService.get<string>('GEOIP_DB_PATH') ||
      path.join(process.cwd(), 'data/GeoLite2-City.mmdb')
    );
  }

  /**
   * Load the MaxMind database.
   */
  private async loadDatabase(): Promise<void> {
    const dbPath = this.getDbPath();

    try {
      if (!fs.existsSync(dbPath)) {
        this.logger.warn(`GeoLite2 database not found at ${dbPath}`);
        this.logger.warn('Geo location will return empty results');
        this.logger.warn(
          'Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data',
        );
        return;
      }

      this.reader = await Reader.open(dbPath);
      this.logger.log('GeoLite2-City database loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load GeoLite2 database', error);
    }
  }

  /**
   * Look up geographic location for an IP address and apply workspace settings.
   *
   * The IP address is used only for lookup and is NOT stored.
   *
   * @param ip - The IP address to look up
   * @param settings - Workspace geo settings (optional, defaults apply if not provided)
   * @returns GeoLocation with settings applied
   */
  lookupWithSettings(
    ip: string | null,
    settings: Partial<GeoSettings> = {},
  ): GeoLocation {
    const mergedSettings: GeoSettings = {
      ...DEFAULT_GEO_SETTINGS,
      ...settings,
    };

    // If geo is disabled, return empty
    if (!mergedSettings.geo_enabled) {
      return EMPTY_GEO;
    }

    // If no IP, return empty
    if (!ip) {
      return EMPTY_GEO;
    }

    // Get raw lookup (cached)
    const raw = this.lookupRaw(ip);

    // Apply settings
    return {
      country: raw.country,
      region: mergedSettings.geo_store_region ? raw.region : null,
      city: mergedSettings.geo_store_city ? raw.city : null,
      latitude: this.roundCoordinate(
        raw.latitude,
        mergedSettings.geo_coordinates_precision,
      ),
      longitude: this.roundCoordinate(
        raw.longitude,
        mergedSettings.geo_coordinates_precision,
      ),
    };
  }

  /**
   * Raw MaxMind lookup with caching.
   * This returns the full geo data before workspace settings are applied.
   */
  private lookupRaw(ip: string): GeoLocation {
    // Ignore localhost and private IPs
    if (this.isPrivateOrLocalhost(ip)) {
      return EMPTY_GEO;
    }

    // Check cache first
    const cached = this.cache.get(ip);
    if (cached && cached.expires > Date.now()) {
      return cached.geo;
    }

    // Database not loaded
    if (!this.reader) {
      return EMPTY_GEO;
    }

    try {
      const response = this.reader.city(ip);

      const geo: GeoLocation = {
        country: response.country?.isoCode ?? null,
        region: response.subdivisions?.[0]?.names?.en ?? null,
        city: response.city?.names?.en ?? null,
        latitude: response.location?.latitude ?? null,
        longitude: response.location?.longitude ?? null,
      };

      // Cache the result
      this.cacheResult(ip, geo);

      return geo;
    } catch {
      // AddressNotFoundError is common for some IP ranges
      return EMPTY_GEO;
    }
  }

  /**
   * Round coordinate to specified precision.
   */
  private roundCoordinate(
    value: number | null,
    precision: number,
  ): number | null {
    if (value === null) return null;
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  /**
   * Cache a geo lookup result.
   */
  private cacheResult(ip: string, geo: GeoLocation): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(ip, {
      geo,
      expires: Date.now() + this.CACHE_TTL_MS,
    });
  }

  /**
   * Check if IP is localhost or private network.
   */
  private isPrivateOrLocalhost(ip: string): boolean {
    // IPv4 localhost
    if (ip === '127.0.0.1') return true;

    // IPv6 localhost
    if (ip === '::1' || ip.toLowerCase() === '::ffff:127.0.0.1') return true;

    // IPv4 private ranges
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;

    // Link-local
    if (ip.startsWith('169.254.')) return true;

    return false;
  }

  /**
   * Reload database (call after downloading updates).
   */
  async reloadDatabase(): Promise<void> {
    this.cache.clear();
    await this.loadDatabase();
  }

  /**
   * Check if the database is loaded.
   */
  isReady(): boolean {
    return this.reader !== null;
  }
}
