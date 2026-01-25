import { Injectable, BadRequestException } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  UserEventsQueryDto,
  UserEventRow,
  UserEventsResponse,
} from './dto/user-events-query.dto';

interface CursorData {
  updated_at: string;
  id: string;
}

@Injectable()
export class ExportService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async getUserEvents(dto: UserEventsQueryDto): Promise<UserEventsResponse> {
    // Validate workspace exists
    await this.workspacesService.get(dto.workspace_id);

    // Require either cursor or since to prevent full table scan
    if (!dto.cursor && !dto.since) {
      throw new BadRequestException(
        'Either cursor or since parameter is required',
      );
    }

    const limit = dto.limit ?? 100;
    const params: Record<string, unknown> = {};
    let cursorData: CursorData | null = null;

    // Parse cursor if provided
    if (dto.cursor) {
      try {
        const decoded = Buffer.from(dto.cursor, 'base64').toString();
        cursorData = JSON.parse(decoded) as CursorData;
        if (!cursorData.updated_at || !cursorData.id) {
          throw new Error('Invalid cursor structure');
        }
      } catch {
        throw new BadRequestException('Invalid cursor format');
      }
    }

    // Build WHERE conditions
    const conditions: string[] = ['user_id IS NOT NULL'];

    if (cursorData) {
      // Cursor-based pagination (timestamp ties use id as tiebreaker)
      conditions.push(
        '(updated_at, id) > ({cursor_updated_at:String}, {cursor_id:String})',
      );
      params.cursor_updated_at = cursorData.updated_at;
      params.cursor_id = cursorData.id;
    } else if (dto.since) {
      // Initial query with since timestamp
      const sinceDate = new Date(dto.since);
      const sinceClickhouse = this.toClickHouseDateTime(sinceDate);
      conditions.push('updated_at >= {since:String}');
      params.since = sinceClickhouse;
    }

    // Add until constraint (always applied, even with cursor)
    const untilDate = new Date(dto.until);
    const untilClickhouse = this.toClickHouseDateTime(untilDate);
    conditions.push('updated_at <= {until:String}');
    params.until = untilClickhouse;

    // Optional user_id filter
    if (dto.user_id) {
      conditions.push('user_id = {user_id:String}');
      params.user_id = dto.user_id;
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT
        toString(id) as id,
        session_id,
        user_id,
        name,
        path,
        toString(created_at) as created_at,
        toString(updated_at) as updated_at,
        referrer,
        referrer_domain,
        is_direct,
        landing_page,
        landing_domain,
        landing_path,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        utm_id,
        utm_id_from,
        channel,
        channel_group,
        stm_1,
        stm_2,
        stm_3,
        stm_4,
        stm_5,
        stm_6,
        stm_7,
        stm_8,
        stm_9,
        stm_10,
        device,
        browser,
        browser_type,
        os,
        country,
        region,
        city,
        language,
        timezone,
        goal_name,
        goal_value,
        toString(goal_timestamp) as goal_timestamp,
        page_number,
        duration,
        max_scroll
      FROM events FINAL
      WHERE ${whereClause}
      ORDER BY updated_at ASC, id ASC
      LIMIT ${limit + 1}
    `;

    const rows = await this.clickhouse.queryWorkspace<UserEventRow>(
      dto.workspace_id,
      sql,
      params,
    );

    // Determine if there are more rows
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    // Generate next cursor from last item
    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const lastItem = data[data.length - 1];
      const cursorPayload: CursorData = {
        updated_at: lastItem.updated_at,
        id: lastItem.id,
      };
      nextCursor = Buffer.from(JSON.stringify(cursorPayload)).toString(
        'base64',
      );
    }

    return {
      data,
      next_cursor: nextCursor,
      has_more: hasMore,
    };
  }

  private toClickHouseDateTime(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '');
  }
}
