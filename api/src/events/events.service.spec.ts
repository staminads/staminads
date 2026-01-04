import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventBufferService } from './event-buffer.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { GeoService, EMPTY_GEO } from '../geo';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { TrackEventDto } from './dto/track-event.dto';

describe('EventsService', () => {
  let service: EventsService;
  let bufferService: jest.Mocked<EventBufferService>;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let geoService: jest.Mocked<GeoService>;

  const mockWorkspace: Workspace = {
    id: 'ws-1',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    status: 'active',
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
    settings: {
      timescore_reference: 180,
      bounce_threshold: 10,
      custom_dimensions: {},
      filters: [],
      integrations: [],
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
    },
  };

  const mockWorkspaceWithFilters: Workspace = {
    ...mockWorkspace,
    id: 'ws-filters',
    settings: {
      ...mockWorkspace.settings,
      filters: [
        {
          id: 'filter-1',
          name: 'Google Traffic',
          priority: 500,
          order: 0,
          tags: ['organic'],
          conditions: [
            { field: 'referrer_domain', operator: 'contains', value: 'google' },
          ],
          operations: [
            {
              dimension: 'channel',
              action: 'set_value',
              value: 'Organic Search',
            },
          ],
          enabled: true,
          version: 'v1',
          createdAt: '2025-01-01 00:00:00',
          updatedAt: '2025-01-01 00:00:00',
        },
      ],
    },
  };

  const createTrackEventDto = (
    overrides: Partial<TrackEventDto> = {},
  ): TrackEventDto => ({
    workspace_id: 'ws-1',
    session_id: 'session-123',
    name: 'screen_view',
    path: '/test-page',
    landing_page: 'https://example.com/landing',
    created_at: 1704067200000, // 2024-01-01T00:00:00.000Z
    updated_at: 1704067200000,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: ClickHouseService,
          useValue: {},
        },
        {
          provide: EventBufferService,
          useValue: {
            add: jest.fn(),
            addBatch: jest.fn(),
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: GeoService,
          useValue: {
            lookupWithSettings: jest.fn().mockReturnValue(EMPTY_GEO),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    bufferService = module.get(EventBufferService);
    workspacesService = module.get(WorkspacesService);
    geoService = module.get(GeoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('track', () => {
    it('tracks single event successfully', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      const result = await service.track(dto, '8.8.8.8');

      expect(result).toEqual({ success: true });
      expect(bufferService.add).toHaveBeenCalledTimes(1);
    });

    it('applies geo lookup with workspace settings', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      await service.track(dto, '8.8.8.8');

      expect(geoService.lookupWithSettings).toHaveBeenCalledWith('8.8.8.8', {
        geo_enabled: true,
        geo_store_city: true,
        geo_store_region: true,
        geo_coordinates_precision: 2,
      });
    });

    it('passes null IP to geo service', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      await service.track(dto, null);

      expect(geoService.lookupWithSettings).toHaveBeenCalledWith(
        null,
        expect.any(Object),
      );
    });

    it('parses referrer URL to extract domain and path', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        referrer: 'https://google.com/search?q=test',
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.referrer_domain).toBe('google.com');
      expect(addedEvent.referrer_path).toBe('/search');
    });

    it('parses landing_page URL to extract domain and path', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        landing_page: 'https://example.com/products/item',
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.landing_domain).toBe('example.com');
      expect(addedEvent.landing_path).toBe('/products/item');
    });

    it('handles invalid URLs gracefully', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        referrer: 'not-a-valid-url',
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.referrer_domain).toBe('');
      expect(addedEvent.referrer_path).toBe('');
    });

    it('sets is_direct based on referrer presence', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      // Without referrer - should be direct
      const dtoWithoutReferrer = createTrackEventDto();
      await service.track(dtoWithoutReferrer, null);
      expect(bufferService.add.mock.calls[0][0].is_direct).toBe(true);

      // With referrer - should not be direct
      const dtoWithReferrer = createTrackEventDto({
        referrer: 'https://google.com',
      });
      await service.track(dtoWithReferrer, null);
      expect(bufferService.add.mock.calls[1][0].is_direct).toBe(false);
    });

    it('uses provided is_direct value when specified', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        referrer: 'https://google.com',
        is_direct: true, // Explicitly set despite having referrer
      });
      await service.track(dto, null);

      expect(bufferService.add.mock.calls[0][0].is_direct).toBe(true);
    });

    it('uses provided referrer_domain when specified', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        referrer: 'https://google.com/search',
        referrer_domain: 'custom-domain.com',
      });
      await service.track(dto, null);

      expect(bufferService.add.mock.calls[0][0].referrer_domain).toBe(
        'custom-domain.com',
      );
    });

    it('throws BadRequestException for invalid workspace_id', async () => {
      workspacesService.get.mockRejectedValue(new Error('Not found'));

      const dto = createTrackEventDto({ workspace_id: 'invalid-ws' });

      await expect(service.track(dto, null)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.track(dto, null)).rejects.toThrow(
        'Invalid workspace_id',
      );
    });

    it('applies filters from workspace', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspaceWithFilters);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        workspace_id: 'ws-filters',
        referrer: 'https://google.com/search',
        referrer_domain: 'google.com',
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.channel).toBe('Organic Search');
    });

    it('sets default values for optional fields', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.duration).toBe(0);
      expect(addedEvent.screen_width).toBe(0);
      expect(addedEvent.screen_height).toBe(0);
      expect(addedEvent.max_scroll).toBe(0);
      expect(addedEvent.utm_source).toBe('');
      expect(addedEvent.language).toBe('');
    });

    it('includes geo data in tracked event', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);
      geoService.lookupWithSettings.mockReturnValue({
        country: 'US',
        region: 'California',
        city: 'San Francisco',
        latitude: 37.77,
        longitude: -122.42,
      });

      const dto = createTrackEventDto();
      await service.track(dto, '8.8.8.8');

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.country).toBe('US');
      expect(addedEvent.region).toBe('California');
      expect(addedEvent.city).toBe('San Francisco');
      expect(addedEvent.latitude).toBe(37.77);
      expect(addedEvent.longitude).toBe(-122.42);
    });
  });

  describe('trackBatch', () => {
    it('tracks batch of events successfully', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.addBatch.mockResolvedValue(undefined);

      const dtos = [
        createTrackEventDto({ session_id: 'session-1' }),
        createTrackEventDto({ session_id: 'session-2' }),
      ];
      const result = await service.trackBatch(dtos, '8.8.8.8');

      expect(result).toEqual({ success: true, count: 2 });
      expect(bufferService.addBatch).toHaveBeenCalledTimes(1);
    });

    it('returns success with count 0 for empty batch', async () => {
      const result = await service.trackBatch([], null);

      expect(result).toEqual({ success: true, count: 0 });
      expect(workspacesService.get).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when batch has mixed workspace_ids', async () => {
      const dtos = [
        createTrackEventDto({ workspace_id: 'ws-1' }),
        createTrackEventDto({ workspace_id: 'ws-2' }), // Different workspace
      ];

      await expect(service.trackBatch(dtos, null)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.trackBatch(dtos, null)).rejects.toThrow(
        'All events in batch must have the same workspace_id',
      );
    });

    it('applies geo lookup once for entire batch', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.addBatch.mockResolvedValue(undefined);

      const dtos = [
        createTrackEventDto({ session_id: 'session-1' }),
        createTrackEventDto({ session_id: 'session-2' }),
        createTrackEventDto({ session_id: 'session-3' }),
      ];
      await service.trackBatch(dtos, '8.8.8.8');

      // Geo lookup should only be called once for the batch
      expect(geoService.lookupWithSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('workspace caching', () => {
    it('caches workspace config for repeated requests', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();

      // Track multiple events
      await service.track(dto, null);
      await service.track(dto, null);
      await service.track(dto, null);

      // Workspace should only be fetched once (cached)
      expect(workspacesService.get).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache when filters change', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();

      await service.track(dto, null);
      expect(workspacesService.get).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.invalidateCache('ws-1');

      // Next request should fetch again
      await service.track(dto, null);
      expect(workspacesService.get).toHaveBeenCalledTimes(2);
    });

    it('handles filters.changed event', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      await service.track(dto, null);

      // Simulate filters.changed event
      service.handleFiltersChanged({ workspaceId: 'ws-1' });

      // Cache should be invalidated
      await service.track(dto, null);
      expect(workspacesService.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom dimensions', () => {
    it('initializes all stm fields to empty string', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.stm_1).toBe('');
      expect(addedEvent.stm_2).toBe('');
      expect(addedEvent.stm_3).toBe('');
      expect(addedEvent.stm_4).toBe('');
      expect(addedEvent.stm_5).toBe('');
      expect(addedEvent.stm_6).toBe('');
      expect(addedEvent.stm_7).toBe('');
      expect(addedEvent.stm_8).toBe('');
      expect(addedEvent.stm_9).toBe('');
      expect(addedEvent.stm_10).toBe('');
    });
  });

  describe('UTM parameters', () => {
    it('preserves all UTM parameters from dto', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'summer-sale',
        utm_term: 'analytics',
        utm_content: 'banner-1',
        utm_id: 'utm-123',
        utm_id_from: 'google-ads',
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.utm_source).toBe('google');
      expect(addedEvent.utm_medium).toBe('cpc');
      expect(addedEvent.utm_campaign).toBe('summer-sale');
      expect(addedEvent.utm_term).toBe('analytics');
      expect(addedEvent.utm_content).toBe('banner-1');
      expect(addedEvent.utm_id).toBe('utm-123');
      expect(addedEvent.utm_id_from).toBe('google-ads');
    });
  });

  describe('device information', () => {
    it('preserves device information from dto', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        screen_width: 1920,
        screen_height: 1080,
        viewport_width: 1600,
        viewport_height: 900,
        device: 'Desktop',
        browser: 'Chrome',
        browser_type: 'browser',
        os: 'macOS',
        user_agent: 'Mozilla/5.0',
        connection_type: '4g',
        language: 'en-US',
        timezone: 'America/New_York',
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.screen_width).toBe(1920);
      expect(addedEvent.screen_height).toBe(1080);
      expect(addedEvent.device).toBe('Desktop');
      expect(addedEvent.browser).toBe('Chrome');
      expect(addedEvent.os).toBe('macOS');
      expect(addedEvent.language).toBe('en-US');
    });
  });

  describe('properties', () => {
    it('preserves custom properties from dto', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto({
        properties: {
          product_id: 'prod-123',
          category: 'electronics',
        },
      });
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.properties).toEqual({
        product_id: 'prod-123',
        category: 'electronics',
      });
    });

    it('defaults properties to empty object', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      bufferService.add.mockResolvedValue(undefined);

      const dto = createTrackEventDto();
      await service.track(dto, null);

      const addedEvent = bufferService.add.mock.calls[0][0];
      expect(addedEvent.properties).toEqual({});
    });
  });
});
