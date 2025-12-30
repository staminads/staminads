import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ClickHouseService } from '../database/clickhouse.service';
import { EventBufferService } from './event-buffer.service';
import { TrackEventDto } from './dto/track-event.dto';
import { TrackingEvent } from './entities/event.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import {
  extractFieldValues,
  applyFilterResults,
} from '../filters/lib/filter-evaluator';
import { computeCustomDimensions } from '../custom-dimensions/lib/rule-evaluator';

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
  ) {}

  async track(dto: TrackEventDto): Promise<{ success: boolean }> {
    const workspace = await this.getWorkspaceConfig(dto.workspace_id);
    const event = this.buildEvent(dto, workspace);
    await this.buffer.add(event);

    return { success: true };
  }

  async trackBatch(
    dtos: TrackEventDto[],
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
    const events = dtos.map((dto) => this.buildEvent(dto, workspace));
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
  private buildEvent(dto: TrackEventDto, workspace: Workspace): TrackingEvent {
    const referrerParsed = parseUrl(dto.referrer);
    const landingParsed = parseUrl(dto.landing_page);
    const now = toClickHouseDateTime();

    // Build base event with raw values
    const baseEvent: TrackingEvent = {
      session_id: dto.session_id,
      workspace_id: dto.workspace_id,
      created_at: now,
      name: dto.name,
      path: dto.path,
      duration: dto.duration ?? 0,

      // Traffic source
      referrer: dto.referrer ?? null,
      referrer_domain: dto.referrer_domain ?? referrerParsed.domain,
      referrer_path: dto.referrer_path ?? referrerParsed.path,
      is_direct: dto.is_direct ?? !dto.referrer,

      // Landing page
      landing_page: dto.landing_page,
      landing_domain: dto.landing_domain ?? landingParsed.domain,
      landing_path: dto.landing_path ?? landingParsed.path,

      // UTM
      utm_source: dto.utm_source ?? null,
      utm_medium: dto.utm_medium ?? null,
      utm_campaign: dto.utm_campaign ?? null,
      utm_term: dto.utm_term ?? null,
      utm_content: dto.utm_content ?? null,
      utm_id: dto.utm_id ?? null,
      utm_id_from: dto.utm_id_from ?? null,

      // Device
      screen_width: dto.screen_width ?? null,
      screen_height: dto.screen_height ?? null,
      viewport_width: dto.viewport_width ?? null,
      viewport_height: dto.viewport_height ?? null,
      device: dto.device ?? null,
      browser: dto.browser ?? null,
      browser_type: dto.browser_type ?? null,
      os: dto.os ?? null,
      user_agent: dto.user_agent ?? null,
      connection_type: dto.connection_type ?? null,

      // Browser APIs
      language: dto.language ?? null,
      timezone: dto.timezone ?? null,

      // Engagement
      max_scroll: dto.max_scroll ?? null,

      // SDK
      sdk_version: dto.sdk_version ?? null,

      // Properties
      properties: dto.properties ?? {},

      // Custom dimensions (will be set below)
      cd_1: null,
      cd_2: null,
      cd_3: null,
      cd_4: null,
      cd_5: null,
      cd_6: null,
      cd_7: null,
      cd_8: null,
      cd_9: null,
      cd_10: null,
      filter_version: null,
    };

    // Apply filters if workspace has them configured
    const filters = workspace.filters ?? [];
    const customDimensions = workspace.custom_dimensions ?? [];

    if (filters.length > 0) {
      // Use new filters system (priority-based)
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
    } else if (customDimensions.length > 0) {
      // Fall back to legacy custom dimensions system
      const fieldValues = extractFieldValues(baseEvent as unknown as Record<string, unknown>);
      const cdValues = computeCustomDimensions(customDimensions, fieldValues);
      Object.assign(baseEvent, cdValues);
    }

    return baseEvent;
  }
}
