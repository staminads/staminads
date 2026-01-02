import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ClickHouseService } from '../database/clickhouse.service';
import { EventBufferService } from './event-buffer.service';
import { TrackEventDto } from './dto/track-event.dto';
import { TrackingEvent } from './entities/event.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { GeoService, GeoLocation, EMPTY_GEO } from '../geo';
import {
  extractFieldValues,
  applyFilterResults,
} from '../filters/lib/filter-evaluator';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function parseUrl(urlString: string | undefined): {
  domain: string | null;
  path: string | null;
} {
  if (!urlString) return { domain: null, path: null };
  try {
    const url = new URL(urlString);
    return {
      domain: url.hostname,
      path: url.pathname,
    };
  } catch {
    return { domain: null, path: null };
  }
}

// Simple in-memory cache for workspace configs
interface CachedWorkspace {
  workspace: Workspace;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private workspaceCache = new Map<string, CachedWorkspace>();

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly buffer: EventBufferService,
    private readonly workspacesService: WorkspacesService,
    private readonly geoService: GeoService,
  ) {}

  async track(
    dto: TrackEventDto,
    clientIp: string | null,
  ): Promise<{ success: boolean }> {
    const workspace = await this.getWorkspaceConfig(dto.workspace_id);

    // Perform geo lookup with workspace settings (IP is never stored)
    const geo = this.geoService.lookupWithSettings(clientIp, {
      geo_enabled: workspace.geo_enabled,
      geo_store_city: workspace.geo_store_city,
      geo_store_region: workspace.geo_store_region,
      geo_coordinates_precision: workspace.geo_coordinates_precision,
    });

    const event = this.buildEvent(dto, workspace, geo);
    await this.buffer.add(event);

    return { success: true };
  }

  async trackBatch(
    dtos: TrackEventDto[],
    clientIp: string | null,
  ): Promise<{ success: boolean; count: number }> {
    if (dtos.length === 0) {
      return { success: true, count: 0 };
    }

    // Validate workspace (all events in batch should have same workspace_id)
    const workspaceId = dtos[0].workspace_id;
    if (dtos.some((dto) => dto.workspace_id !== workspaceId)) {
      throw new BadRequestException(
        'All events in batch must have the same workspace_id',
      );
    }

    const workspace = await this.getWorkspaceConfig(workspaceId);

    // Perform geo lookup once for the batch (same IP for all events)
    const geo = this.geoService.lookupWithSettings(clientIp, {
      geo_enabled: workspace.geo_enabled,
      geo_store_city: workspace.geo_store_city,
      geo_store_region: workspace.geo_store_region,
      geo_coordinates_precision: workspace.geo_coordinates_precision,
    });

    const events = dtos.map((dto) => this.buildEvent(dto, workspace, geo));
    await this.buffer.addBatch(events);

    return { success: true, count: events.length };
  }

  /**
   * Get workspace configuration with caching.
   */
  private async getWorkspaceConfig(workspaceId: string): Promise<Workspace> {
    const now = Date.now();
    const cached = this.workspaceCache.get(workspaceId);

    if (cached && cached.expiresAt > now) {
      return cached.workspace;
    }

    try {
      const workspace = await this.workspacesService.get(workspaceId);
      this.workspaceCache.set(workspaceId, {
        workspace,
        expiresAt: now + CACHE_TTL_MS,
      });
      return workspace;
    } catch (error) {
      throw new BadRequestException(`Invalid workspace_id: ${workspaceId}`);
    }
  }

  /**
   * Invalidate workspace cache (called when filters change).
   */
  invalidateCache(workspaceId: string): void {
    this.workspaceCache.delete(workspaceId);
  }

  /**
   * Handle filters.changed event to invalidate cache.
   */
  @OnEvent('filters.changed')
  handleFiltersChanged(payload: { workspaceId: string }): void {
    this.invalidateCache(payload.workspaceId);
  }

  /**
   * Build a tracking event from a DTO, applying filters and custom dimensions.
   */
  private buildEvent(
    dto: TrackEventDto,
    workspace: Workspace,
    geo: GeoLocation,
  ): TrackingEvent {
    const referrerParsed = parseUrl(dto.referrer);
    const landingParsed = parseUrl(dto.landing_page);
    const now = toClickHouseDateTime();

    // Build base event with raw values
    const baseEvent: TrackingEvent = {
      session_id: dto.session_id,
      workspace_id: dto.workspace_id,
      received_at: now,  // Server timestamp
      created_at: toClickHouseDateTime(new Date(dto.created_at)),  // SDK session start
      updated_at: toClickHouseDateTime(new Date(dto.updated_at)),  // SDK last interaction
      name: dto.name,
      path: dto.path,
      duration: dto.duration ?? 0,

      // Traffic source
      referrer: dto.referrer ?? '',
      referrer_domain: dto.referrer_domain ?? referrerParsed.domain ?? '',
      referrer_path: dto.referrer_path ?? referrerParsed.path ?? '',
      is_direct: dto.is_direct ?? !dto.referrer,

      // Landing page
      landing_page: dto.landing_page,
      landing_domain: dto.landing_domain ?? landingParsed.domain ?? '',
      landing_path: dto.landing_path ?? landingParsed.path ?? '',

      // UTM
      utm_source: dto.utm_source ?? '',
      utm_medium: dto.utm_medium ?? '',
      utm_campaign: dto.utm_campaign ?? '',
      utm_term: dto.utm_term ?? '',
      utm_content: dto.utm_content ?? '',
      utm_id: dto.utm_id ?? '',
      utm_id_from: dto.utm_id_from ?? '',

      // Device
      screen_width: dto.screen_width ?? 0,
      screen_height: dto.screen_height ?? 0,
      viewport_width: dto.viewport_width ?? 0,
      viewport_height: dto.viewport_height ?? 0,
      device: dto.device ?? '',
      browser: dto.browser ?? '',
      browser_type: dto.browser_type ?? '',
      os: dto.os ?? '',
      user_agent: dto.user_agent ?? '',
      connection_type: dto.connection_type ?? '',

      // Browser APIs
      language: dto.language ?? '',
      timezone: dto.timezone ?? '',

      // Geo location (derived from IP, IP never stored)
      country: geo.country ?? '',
      region: geo.region ?? '',
      city: geo.city ?? '',
      latitude: geo.latitude,
      longitude: geo.longitude,

      // Engagement
      max_scroll: dto.max_scroll ?? 0,

      // SDK
      sdk_version: dto.sdk_version ?? '',

      // Properties
      properties: dto.properties ?? {},

      // Channel classification (will be set below)
      channel: '',
      channel_group: '',

      // Custom dimensions (will be set below)
      stm_1: '',
      stm_2: '',
      stm_3: '',
      stm_4: '',
      stm_5: '',
      stm_6: '',
      stm_7: '',
      stm_8: '',
      stm_9: '',
      stm_10: '',
    };

    // Apply filters if workspace has them configured
    const filters = workspace.filters ?? [];

    if (filters.length > 0) {
      // Use filters system (priority-based)
      const fieldValues = extractFieldValues(baseEvent as unknown as Record<string, unknown>);
      const { customDimensions: cdValues, modifiedFields } = applyFilterResults(
        filters,
        fieldValues,
        baseEvent as unknown as Record<string, unknown>,
      );

      // Apply custom dimension values
      Object.assign(baseEvent, cdValues);

      // Apply modified standard fields (utm_*, referrer_domain, is_direct)
      for (const [field, value] of Object.entries(modifiedFields)) {
        if (field === 'is_direct') {
          (baseEvent as any)[field] = value === 'true';
        } else {
          (baseEvent as any)[field] = value;
        }
      }
    }

    return baseEvent;
  }
}
