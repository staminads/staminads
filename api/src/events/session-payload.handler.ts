import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventBufferService } from './event-buffer.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { GeoService, GeoLocation } from '../geo';
import { Workspace } from '../workspaces/entities/workspace.entity';
import {
  SessionPayloadDto,
  PageviewActionDto,
  GoalActionDto,
  Action,
  isPageviewAction,
  isGoalAction,
} from './dto/session-payload.dto';
import { TrackingEvent } from './entities/event.entity';
import { toClickHouseDateTime } from '../common/utils/datetime.util';
import {
  extractFieldValues,
  applyFilterResults,
} from '../filters/lib/filter-evaluator';

export interface HandleResult {
  success: boolean;
  checkpoint: number;
}

// Workspace cache (same pattern as EventsService)
interface CachedWorkspace {
  workspace: Workspace;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

@Injectable()
export class SessionPayloadHandler {
  private readonly logger = new Logger(SessionPayloadHandler.name);
  private workspaceCache = new Map<string, CachedWorkspace>();

  constructor(
    private readonly buffer: EventBufferService,
    private readonly workspacesService: WorkspacesService,
    private readonly geoService: GeoService,
  ) {}

  async handle(
    payload: SessionPayloadDto,
    clientIp: string | null,
  ): Promise<HandleResult> {
    // 1. Validate workspace
    const workspace = await this.getWorkspace(payload.workspace_id);

    // 2. Filter actions by checkpoint
    const startIndex = (payload.checkpoint ?? -1) + 1;
    const actionsToProcess = payload.actions.slice(startIndex);

    if (actionsToProcess.length === 0) {
      return { success: true, checkpoint: payload.actions.length };
    }

    // 3. Perform geo lookup once
    const geo = this.geoService.lookupWithSettings(clientIp, {
      geo_enabled: workspace.settings.geo_enabled,
      geo_store_city: workspace.settings.geo_store_city,
      geo_store_region: workspace.settings.geo_store_region,
      geo_coordinates_precision: workspace.settings.geo_coordinates_precision,
    });

    // 4. Set _version for all events (same timestamp for entire payload)
    const version = Date.now();

    // 5. Build base event from session attributes
    const baseEvent = this.buildBaseEvent(payload, geo, version);

    // 6. Deserialize actions to events
    const events: TrackingEvent[] = [];
    let previousPath = '';

    // Build previous_path chain from ALL actions (not just those being processed)
    for (let i = 0; i < startIndex && i < payload.actions.length; i++) {
      const action = payload.actions[i];
      if (isPageviewAction(action)) {
        previousPath = action.path;
      }
    }

    for (const action of actionsToProcess) {
      const event = this.deserializeAction(
        action,
        baseEvent,
        payload.session_id,
        previousPath,
      );
      events.push(event);

      // Update previous_path for next pageview
      if (isPageviewAction(action)) {
        previousPath = action.path;
      }
    }

    // 7. Apply filters if configured
    const filters = workspace.settings.filters ?? [];
    if (filters.length > 0) {
      for (const event of events) {
        this.applyFilters(event, filters);
      }
    }

    // 8. Add to buffer
    await this.buffer.addBatch(events);

    return { success: true, checkpoint: payload.actions.length };
  }

  private async getWorkspace(workspaceId: string): Promise<Workspace> {
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
    } catch {
      throw new BadRequestException(`Invalid workspace_id: ${workspaceId}`);
    }
  }

  /**
   * Invalidate workspace cache (called when filters change).
   */
  @OnEvent('filters.changed')
  handleFiltersChanged(payload: { workspaceId: string }): void {
    this.workspaceCache.delete(payload.workspaceId);
  }

  private buildBaseEvent(
    payload: SessionPayloadDto,
    geo: GeoLocation,
    version: number,
  ): Partial<TrackingEvent> {
    const attrs = payload.attributes;
    const now = toClickHouseDateTime();

    // Parse URLs for derived fields
    const referrerParsed = this.parseUrl(attrs?.referrer);
    const landingParsed = this.parseUrl(attrs?.landing_page);

    return {
      session_id: payload.session_id,
      workspace_id: payload.workspace_id,
      received_at: now,
      created_at: toClickHouseDateTime(new Date(payload.created_at)),
      updated_at: toClickHouseDateTime(new Date(payload.updated_at)),
      _version: version,

      // Traffic source
      referrer: attrs?.referrer ?? '',
      referrer_domain: referrerParsed.domain ?? '',
      referrer_path: referrerParsed.path ?? '',
      is_direct: !attrs?.referrer,

      // Landing page
      landing_page: attrs?.landing_page ?? '',
      landing_domain: landingParsed.domain ?? '',
      landing_path: landingParsed.path ?? '',

      // UTM
      utm_source: attrs?.utm_source ?? '',
      utm_medium: attrs?.utm_medium ?? '',
      utm_campaign: attrs?.utm_campaign ?? '',
      utm_term: attrs?.utm_term ?? '',
      utm_content: attrs?.utm_content ?? '',
      utm_id: attrs?.utm_id ?? '',
      utm_id_from: attrs?.utm_id_from ?? '',

      // Device
      screen_width: attrs?.screen_width ?? 0,
      screen_height: attrs?.screen_height ?? 0,
      viewport_width: attrs?.viewport_width ?? 0,
      viewport_height: attrs?.viewport_height ?? 0,
      device: attrs?.device ?? '',
      browser: attrs?.browser ?? '',
      browser_type: attrs?.browser_type ?? '',
      os: attrs?.os ?? '',
      user_agent: attrs?.user_agent ?? '',
      connection_type: attrs?.connection_type ?? '',

      // Browser APIs
      language: attrs?.language ?? '',
      timezone: attrs?.timezone ?? '',

      // Geo
      country: geo.country ?? '',
      region: geo.region ?? '',
      city: geo.city ?? '',
      latitude: geo.latitude,
      longitude: geo.longitude,

      // SDK
      sdk_version: payload.sdk_version ?? '',

      // Defaults
      channel: '',
      channel_group: '',
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
  }

  private deserializeAction(
    action: Action,
    baseEvent: Partial<TrackingEvent>,
    sessionId: string,
    previousPath: string,
  ): TrackingEvent {
    if (isPageviewAction(action)) {
      return this.deserializePageview(
        action,
        baseEvent,
        sessionId,
        previousPath,
      );
    } else if (isGoalAction(action)) {
      return this.deserializeGoal(action, baseEvent, sessionId);
    }

    // Exhaustive check - should never reach here
    throw new Error(
      `Unknown action type: ${(action as { type: string }).type}`,
    );
  }

  private deserializePageview(
    action: PageviewActionDto,
    baseEvent: Partial<TrackingEvent>,
    sessionId: string,
    previousPath: string,
  ): TrackingEvent {
    return {
      ...baseEvent,
      dedup_token: `${sessionId}_pv_${action.page_number}`,
      name: 'screen_view',
      path: action.path,
      page_number: action.page_number,
      duration: action.duration,
      page_duration: action.duration,
      max_scroll: action.scroll,
      previous_path: previousPath,
      goal_name: '',
      goal_value: 0,
      properties: {},
      // SDK timestamps
      entered_at: toClickHouseDateTime(new Date(action.entered_at)),
      exited_at: toClickHouseDateTime(new Date(action.exited_at)),
      goal_timestamp: '', // Not applicable for pageviews
    } as TrackingEvent;
  }

  private deserializeGoal(
    action: GoalActionDto,
    baseEvent: Partial<TrackingEvent>,
    sessionId: string,
  ): TrackingEvent {
    return {
      ...baseEvent,
      dedup_token: `${sessionId}_goal_${action.name}_${action.timestamp}`,
      name: 'goal',
      path: action.path,
      page_number: action.page_number,
      duration: 0,
      page_duration: 0,
      max_scroll: 0,
      previous_path: '',
      goal_name: action.name,
      goal_value: action.value ?? 0,
      properties: action.properties ?? {},
      // SDK timestamps
      entered_at: '', // Not applicable for goals
      exited_at: '', // Not applicable for goals
      goal_timestamp: toClickHouseDateTime(new Date(action.timestamp)),
    } as TrackingEvent;
  }

  private parseUrl(urlString: string | undefined): {
    domain: string | null;
    path: string | null;
  } {
    if (!urlString) return { domain: null, path: null };
    try {
      const url = new URL(urlString);
      return { domain: url.hostname, path: url.pathname };
    } catch {
      return { domain: null, path: null };
    }
  }

  private applyFilters(
    event: TrackingEvent,
    filters: Workspace['settings']['filters'],
  ): void {
    if (!filters || filters.length === 0) return;

    const eventRecord = event as unknown as Record<string, unknown>;
    const fieldValues = extractFieldValues(eventRecord);
    const { customDimensions, modifiedFields } = applyFilterResults(
      filters,
      fieldValues,
      eventRecord,
    );

    Object.assign(event, customDimensions);

    for (const [field, value] of Object.entries(modifiedFields)) {
      if (field === 'is_direct') {
        eventRecord[field] = value === 'true';
      } else {
        eventRecord[field] = value;
      }
    }
  }
}
