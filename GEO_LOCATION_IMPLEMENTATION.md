# Privacy-Preserving Geo Location from IP Addresses

## Overview

This document outlines how to extract geographic information (country, city, region, latitude/longitude) from visitor IP addresses without storing the IP itself. This approach provides analytics capabilities while maintaining user privacy and GDPR compliance.

## Core Principle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REQUEST LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   HTTP Request                                                               │
│        │                                                                     │
│        ▼                                                                     │
│   ┌─────────────┐     ┌──────────────────┐     ┌─────────────────────────┐  │
│   │ Extract IP  │────▶│  Geo Lookup      │────▶│  Store Geo Data Only    │  │
│   │ from Headers│     │  (Local MaxMind) │     │  (Discard IP)           │  │
│   └─────────────┘     └──────────────────┘     └─────────────────────────┘  │
│                                                                              │
│   IP Address ─────────────────────────────────────────────▶ NEVER STORED    │
│   Geo Data   ─────────────────────────────────────────────▶ PERSISTED       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The IP address is used transiently during request processing and immediately discarded after geo lookup. Only the derived geographic data is persisted.**

---

## Implementation Options

### Option 1: MaxMind GeoLite2 (Recommended)

Local database lookup - no external API calls, fast, free, privacy-preserving.

| Aspect | Details |
|--------|---------|
| Database | GeoLite2-City.mmdb (~70MB) |
| Accuracy | Country: 99%, City: ~80% (varies by region) |
| Cost | Free (GeoLite2) or paid (GeoIP2 for higher accuracy) |
| Latency | <1ms (local lookup) |
| Privacy | No data leaves your server |
| Updates | Weekly database updates available |

### Option 2: External Geo APIs

Cloud-based lookup services.

| Service | Free Tier | Latency | Privacy Concern |
|---------|-----------|---------|-----------------|
| ipinfo.io | 50k/month | ~50-100ms | IP sent to third party |
| ip-api.com | 45/minute | ~50-100ms | IP sent to third party |
| ipstack | 100/month | ~50-100ms | IP sent to third party |
| MaxMind Web API | Pay per lookup | ~50-100ms | IP sent to MaxMind |

**Recommendation**: Use MaxMind GeoLite2 local database. It keeps IPs on your infrastructure, has zero external dependencies, and provides sub-millisecond lookups.

---

## Data Schema

### Geo Location Fields to Store

```typescript
interface GeoLocation {
  country: string | null;    // ISO 3166-1 alpha-2 code (e.g., "US", "FR", "DE")
  region: string | null;     // State/province/subdivision name
  city: string | null;       // City name
  latitude: number | null;   // Decimal degrees (e.g., 37.7749)
  longitude: number | null;  // Decimal degrees (e.g., -122.4194)
  timezone: string | null;   // IANA timezone (e.g., "America/New_York") - optional
}
```

### ClickHouse Table Schema

```sql
-- Add these columns to your events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS country LowCardinality(String);
ALTER TABLE events ADD COLUMN IF NOT EXISTS region LowCardinality(String);
ALTER TABLE events ADD COLUMN IF NOT EXISTS city String;
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude Nullable(Float32);
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude Nullable(Float32);

-- LowCardinality optimizes storage for columns with limited unique values
-- country: ~250 possible values
-- region: ~5000 possible values globally
```

### What NOT to Store

| Field | Reason |
|-------|--------|
| IP address | Privacy - can identify individuals |
| IP hash | Can be rainbow-tabled; unnecessary if not tracking devices |
| Postal/ZIP code | Too granular; can identify small populations |
| ISP/ASN | Often unnecessary; adds storage overhead |

---

## Technical Implementation

### 1. Package Installation

```bash
npm install @maxmind/geoip2-node maxmind
```

### 2. Database Download Script

Create `scripts/download-geo-db.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as zlib from 'zlib';
import * as tar from 'tar';

const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY;
const DB_PATH = path.join(__dirname, '../data/GeoLite2-City.mmdb');

async function downloadDatabase(): Promise<void> {
  // Option 1: Use redistributed version (no license key needed)
  const redistributedUrl =
    'https://raw.githubusercontent.com/GitSquared/node-geolite2-redist/master/redist/GeoLite2-City.mmdb.gz';

  // Option 2: Direct from MaxMind (requires free license key)
  const maxmindUrl = MAXMIND_LICENSE_KEY
    ? `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz`
    : null;

  const url = maxmindUrl || redistributedUrl;

  console.log('Downloading GeoLite2-City database...');

  // Ensure data directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Download and extract
  // Implementation depends on source format (gzip vs tar.gz)
}

// Run weekly via cron or on deployment
downloadDatabase();
```

### 3. Geo Location Service

Create `src/geo/geo.service.ts`:

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Reader, CityResponse } from '@maxmind/geoip2-node';
import * as path from 'path';
import * as fs from 'fs';

export interface GeoLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

const EMPTY_GEO: GeoLocation = {
  country: null,
  region: null,
  city: null,
  latitude: null,
  longitude: null,
  timezone: null,
};

@Injectable()
export class GeoService implements OnModuleInit {
  private readonly logger = new Logger(GeoService.name);
  private reader: Reader<CityResponse> | null = null;
  private cache: Map<string, { geo: GeoLocation; expires: number }> = new Map();

  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly CACHE_MAX_SIZE = 10000;
  private readonly DB_PATH = path.join(__dirname, '../../data/GeoLite2-City.mmdb');

  async onModuleInit(): Promise<void> {
    await this.loadDatabase();
  }

  private async loadDatabase(): Promise<void> {
    try {
      if (!fs.existsSync(this.DB_PATH)) {
        this.logger.warn(`GeoLite2 database not found at ${this.DB_PATH}`);
        this.logger.warn('Geo location will return empty results');
        return;
      }

      this.reader = await Reader.open(this.DB_PATH);
      this.logger.log('GeoLite2-City database loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load GeoLite2 database', error);
    }
  }

  /**
   * Look up geographic location for an IP address.
   * Returns null fields if lookup fails or IP is private/localhost.
   *
   * IMPORTANT: The IP address is used only for lookup and is NOT stored.
   */
  lookup(ip: string): GeoLocation {
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
        timezone: response.location?.timeZone ?? null,
      };

      // Cache the result
      this.cacheResult(ip, geo);

      return geo;
    } catch (error) {
      // AddressNotFoundError is common for some IP ranges
      return EMPTY_GEO;
    }
  }

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

  private isPrivateOrLocalhost(ip: string): boolean {
    // IPv4 localhost
    if (ip === '127.0.0.1') return true;

    // IPv6 localhost
    if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;

    // IPv4 private ranges
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;

    // Link-local
    if (ip.startsWith('169.254.')) return true;

    return false;
  }

  /**
   * Reload database (call after downloading updates)
   */
  async reloadDatabase(): Promise<void> {
    this.cache.clear();
    await this.loadDatabase();
  }
}
```

### 4. IP Extraction Utility

Create `src/geo/get-client-ip.ts`:

```typescript
import { Request } from 'express';

/**
 * Header priority order for extracting client IP.
 * Configurable via IP_HEADER_ORDER environment variable.
 */
const DEFAULT_IP_HEADER_ORDER = [
  'cf-connecting-ip',        // Cloudflare
  'x-real-ip',               // Nginx proxy
  'x-forwarded-for',         // Standard proxy header
  'true-client-ip',          // Akamai, Cloudflare Enterprise
  'x-client-ip',             // General proxy
  'x-cluster-client-ip',     // Rackspace
  'fastly-client-ip',        // Fastly CDN
  'x-vercel-forwarded-for',  // Vercel
  'do-connecting-ip',        // DigitalOcean
];

const IP_HEADER_ORDER = process.env.IP_HEADER_ORDER
  ? process.env.IP_HEADER_ORDER.split(',').map(h => h.trim().toLowerCase())
  : DEFAULT_IP_HEADER_ORDER;

/**
 * Extract the real client IP address from request headers.
 * Handles various proxy and CDN configurations.
 */
export function getClientIp(req: Request): string | null {
  // Check configured headers in priority order
  for (const header of IP_HEADER_ORDER) {
    const value = req.headers[header];

    if (value) {
      const ip = typeof value === 'string' ? value : value[0];

      // x-forwarded-for contains comma-separated list; take the first (original client)
      const clientIp = ip?.split(',')[0]?.trim();

      if (clientIp && isValidIp(clientIp)) {
        return normalizeIp(clientIp);
      }
    }
  }

  // Fallback to socket address
  const socketIp = req.socket?.remoteAddress;
  if (socketIp && isValidIp(socketIp)) {
    return normalizeIp(socketIp);
  }

  return null;
}

/**
 * Basic IP validation (IPv4 and IPv6)
 */
function isValidIp(ip: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;

  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  // IPv4-mapped IPv6
  const ipv4MappedPattern = /^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip) || ipv4MappedPattern.test(ip);
}

/**
 * Normalize IP address format
 */
function normalizeIp(ip: string): string {
  // Convert IPv4-mapped IPv6 to IPv4
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}
```

### 5. Integration with Events Service

Modify `src/events/events.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { GeoService, GeoLocation } from '../geo/geo.service';
import { getClientIp } from '../geo/get-client-ip';
import { Request } from 'express';

@Injectable()
export class EventsService {
  constructor(
    private readonly geoService: GeoService,
    // ... other dependencies
  ) {}

  async trackEvent(req: Request, eventData: TrackEventDto): Promise<void> {
    // Step 1: Extract IP (transient - not stored)
    const ip = getClientIp(req);

    // Step 2: Perform geo lookup (IP used here only)
    const geo: GeoLocation = ip
      ? this.geoService.lookup(ip)
      : { country: null, region: null, city: null, latitude: null, longitude: null, timezone: null };

    // Step 3: Build event with geo data (IP is NOT included)
    const event = {
      workspace_id: eventData.workspaceId,
      session_id: eventData.sessionId,
      event_name: eventData.name,
      event_data: eventData.data,
      timestamp: new Date(),

      // Geo fields - derived from IP, IP itself not stored
      country: geo.country,
      region: geo.region,
      city: geo.city,
      latitude: geo.latitude,
      longitude: geo.longitude,

      // ... other event fields
    };

    // Step 4: Insert to ClickHouse - note: NO IP field
    await this.insertEvent(event);

    // IP variable goes out of scope here and is garbage collected
    // It was never persisted anywhere
  }
}
```

### 6. Geo Module

Create `src/geo/geo.module.ts`:

```typescript
import { Module, Global } from '@nestjs/common';
import { GeoService } from './geo.service';

@Global()
@Module({
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
```

Register in `app.module.ts`:

```typescript
import { GeoModule } from './geo/geo.module';

@Module({
  imports: [
    GeoModule,
    // ... other modules
  ],
})
export class AppModule {}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DETAILED DATA FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

  Client Request
       │
       │ Headers: cf-connecting-ip: 203.0.113.42
       │          user-agent: Mozilla/5.0...
       ▼
┌──────────────────┐
│  API Endpoint    │
│  /events.track   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  EventsService.trackEvent(req, dto)                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ const ip = getClientIp(req);  // "203.0.113.42"             │ │
│  │                                                              │ │
│  │ // IP exists only in memory as local variable               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ const geo = geoService.lookup(ip);                          │ │
│  │                                                              │ │
│  │ // Returns: {                                                │ │
│  │ //   country: "US",                                          │ │
│  │ //   region: "California",                                   │ │
│  │ //   city: "San Francisco",                                  │ │
│  │ //   latitude: 37.7749,                                      │ │
│  │ //   longitude: -122.4194                                    │ │
│  │ // }                                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ const event = {                                              │ │
│  │   workspace_id: "...",                                       │ │
│  │   session_id: "...",                                         │ │
│  │   event_name: "page_view",                                   │ │
│  │   country: geo.country,      // ✓ Stored                    │ │
│  │   region: geo.region,        // ✓ Stored                    │ │
│  │   city: geo.city,            // ✓ Stored                    │ │
│  │   latitude: geo.latitude,    // ✓ Stored                    │ │
│  │   longitude: geo.longitude,  // ✓ Stored                    │ │
│  │   // ip: ???                 // ✗ NOT included              │ │
│  │ };                                                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ await clickhouse.insert(event);                             │ │
│  │                                                              │ │
│  │ // Event persisted with geo data, no IP                     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  // Function returns, 'ip' variable is garbage collected         │
│  // IP address never written to disk, database, or logs          │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Privacy Considerations

### What This Approach Guarantees

| Guarantee | Implementation |
|-----------|----------------|
| IP never in database | Event schema has no IP column |
| IP never in logs | Configure logger to exclude request IPs |
| IP never in queues | Queue payloads contain only geo data |
| IP processed locally | MaxMind database runs on your server |
| No third-party data sharing | No external API calls for geo lookup |

### Additional Hardening

1. **Disable IP logging in production**:
   ```typescript
   // In your logging configuration
   app.use((req, res, next) => {
     // Don't log IPs
     req.ip = '[redacted]';
     next();
   });
   ```

2. **Configure web server to not log IPs**:
   ```nginx
   # Nginx: Use custom log format without $remote_addr
   log_format privacy '$time_local "$request" $status $body_bytes_sent';
   ```

3. **Queue payload validation**:
   ```typescript
   // Ensure IP is never accidentally included in queue payloads
   interface EventQueuePayload {
     workspaceId: string;
     eventName: string;
     geo: GeoLocation;
     // Note: no 'ip' field defined
   }
   ```

---

## GDPR Compliance Notes

### Legal Basis

Under GDPR, processing geo location derived from IP addresses falls under **legitimate interest** (Article 6(1)(f)) when:

1. IP is processed transiently and not stored
2. Only derived, less-identifying data (country/city) is retained
3. Users are informed via privacy policy
4. Data is used for analytics/service improvement

### Privacy Policy Language

Include in your privacy policy:

> **Geographic Data**: When you visit our service, we derive your approximate geographic location (country, region, city) from your IP address for analytics purposes. Your IP address is processed in memory only and is not stored in our databases. Only the derived geographic information is retained.

### Data Subject Rights

Since IP is not stored, there is no IP data to provide for:
- **Right of Access** (Article 15): No IP to disclose
- **Right to Erasure** (Article 17): No IP to delete
- **Right to Rectification** (Article 16): No IP to correct

The stored geo data (country, city) is aggregated statistics and typically not considered personal data on its own.

---

## Performance Considerations

### MaxMind Lookup Performance

| Metric | Value |
|--------|-------|
| Lookup latency | <1ms (from local file) |
| Memory usage | ~100-150MB (database loaded in memory) |
| Cache hit ratio | >90% (for repeat visitors) |

### Caching Strategy

```typescript
// Recommended cache settings
const CACHE_CONFIG = {
  maxSize: 10000,        // Max IPs to cache
  ttlMs: 5 * 60 * 1000,  // 5 minutes TTL
};
```

### Database Updates

GeoLite2 is updated weekly. Options:

1. **Manual**: Download on deployment
2. **Automated**: Weekly cron job
   ```bash
   # Add to crontab
   0 3 * * 0 /path/to/download-geo-db.sh
   ```
3. **Docker**: Update database in container build

---

## Testing

### Unit Test for Geo Service

```typescript
describe('GeoService', () => {
  let service: GeoService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [GeoService],
    }).compile();
    service = module.get(GeoService);
    await service.onModuleInit();
  });

  it('should return geo data for valid public IP', () => {
    // Google's public DNS (well-known, stable location)
    const geo = service.lookup('8.8.8.8');
    expect(geo.country).toBe('US');
    expect(geo.latitude).toBeDefined();
    expect(geo.longitude).toBeDefined();
  });

  it('should return empty geo for localhost', () => {
    const geo = service.lookup('127.0.0.1');
    expect(geo.country).toBeNull();
  });

  it('should return empty geo for private IPs', () => {
    const geo = service.lookup('192.168.1.1');
    expect(geo.country).toBeNull();
  });

  it('should handle invalid IPs gracefully', () => {
    const geo = service.lookup('not-an-ip');
    expect(geo.country).toBeNull();
  });
});
```

### Integration Test

```typescript
describe('Event Tracking with Geo', () => {
  it('should store geo data but not IP', async () => {
    // Track event with known IP
    await request(app.getHttpServer())
      .post('/api/events.track')
      .set('cf-connecting-ip', '8.8.8.8')
      .send({ workspaceId: 'test', name: 'test_event' });

    // Query stored event
    const result = await clickhouse.query(`
      SELECT country, city, ip
      FROM events
      WHERE event_name = 'test_event'
    `);

    // Verify geo data present
    expect(result[0].country).toBe('US');

    // Verify IP column doesn't exist (schema check)
    expect(result[0]).not.toHaveProperty('ip');
  });
});
```

---

## Implementation Checklist

- [ ] Install MaxMind packages (`@maxmind/geoip2-node`)
- [ ] Create database download script
- [ ] Download GeoLite2-City.mmdb to `data/` directory
- [ ] Create `GeoService` with lookup and caching
- [ ] Create `getClientIp` utility function
- [ ] Add geo columns to ClickHouse events table
- [ ] Update events entity/DTO with geo fields
- [ ] Integrate geo lookup in `EventsService.trackEvent()`
- [ ] Verify no IP field in database schema
- [ ] Configure logging to exclude IPs
- [ ] Add geo lookup tests
- [ ] Update privacy policy
- [ ] Set up database update automation (optional)

---

## Summary

| Aspect | Implementation |
|--------|----------------|
| **Geo Data Source** | MaxMind GeoLite2-City (local database) |
| **Data Extracted** | Country, Region, City, Lat/Long, Timezone |
| **IP Storage** | Never - processed in memory only |
| **IP in Logs** | Configure to exclude |
| **External Calls** | None - fully local processing |
| **Lookup Speed** | <1ms with caching |
| **GDPR Status** | Compliant (IP not stored as personal data) |
| **Accuracy** | Country 99%, City ~80% |

This approach provides geographic analytics capabilities while maintaining a strong privacy stance - the IP address exists only momentarily in server memory during request processing and is never persisted to any storage system.
