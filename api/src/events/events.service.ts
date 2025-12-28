import { Injectable, BadRequestException } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { EventBufferService } from './event-buffer.service';
import { TrackEventDto } from './dto/track-event.dto';
import { TrackingEvent } from './entities/event.entity';

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

@Injectable()
export class EventsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly buffer: EventBufferService,
  ) {}

  async track(dto: TrackEventDto): Promise<{ success: boolean }> {
    await this.validateWorkspace(dto.workspace_id);

    const event = this.dtoToEvent(dto);
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

    await this.validateWorkspace(workspaceId);

    const events = dtos.map((dto) => this.dtoToEvent(dto));
    await this.buffer.addBatch(events);

    return { success: true, count: events.length };
  }

  private async validateWorkspace(workspaceId: string): Promise<void> {
    const rows = await this.clickhouse.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = {id:String} LIMIT 1',
      { id: workspaceId },
    );

    if (rows.length === 0) {
      throw new BadRequestException(`Invalid workspace_id: ${workspaceId}`);
    }
  }

  private dtoToEvent(dto: TrackEventDto): TrackingEvent {
    const referrerParsed = parseUrl(dto.referrer);
    const landingParsed = parseUrl(dto.landing_page);
    const now = toClickHouseDateTime();

    return {
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

      // Channel (derive from UTM or referrer if not provided)
      channel: dto.channel ?? this.deriveChannel(dto),

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
    };
  }

  private deriveChannel(dto: TrackEventDto): string | null {
    if (dto.utm_source) return dto.utm_source;
    if (dto.referrer) return 'referral';
    return 'direct';
  }
}
