import { Injectable, NotFoundException } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { randomUUID } from 'crypto';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import {
  Subscription,
  SubscriptionFrequency,
} from './entities/subscription.entity';
import { toClickHouseDateTime } from '../common/utils/datetime.util';
import { serializeFilters } from './lib/filter-serializer';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async create(
    dto: CreateSubscriptionDto,
    userId: string,
  ): Promise<Subscription> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const id = randomUUID();
    const now = toClickHouseDateTime();
    const hour = dto.hour ?? 8;

    const subscriptionTimezone = dto.timezone ?? workspace.timezone;

    const nextSendAt = this.calculateNextSendAt(
      dto.frequency,
      hour,
      dto.day_of_week,
      dto.day_of_month,
      subscriptionTimezone,
    );

    const subscription: Subscription = {
      id,
      user_id: userId,
      workspace_id: dto.workspace_id,
      name: dto.name,
      frequency: dto.frequency,
      day_of_week: dto.day_of_week,
      day_of_month: dto.day_of_month,
      hour,
      timezone: subscriptionTimezone,
      metrics: dto.metrics,
      dimensions: dto.dimensions ?? [],
      filters: serializeFilters(dto.filters),
      limit: dto.limit ?? 10,
      status: 'active',
      last_send_status: 'pending',
      last_error: '',
      next_send_at: nextSendAt,
      consecutive_failures: 0,
      created_at: now,
      updated_at: now,
    };

    await this.insertSubscription(subscription);
    return subscription;
  }

  async list(workspaceId: string, userId: string): Promise<Subscription[]> {
    const sql = `
      SELECT *
      FROM report_subscriptions FINAL
      WHERE user_id = {user_id:String}
        AND workspace_id = {workspace_id:String}
        AND status != 'disabled'
      ORDER BY created_at DESC
    `;

    return this.clickhouse.querySystem<Subscription>(sql, {
      user_id: userId,
      workspace_id: workspaceId,
    });
  }

  async get(id: string, userId: string): Promise<Subscription | null> {
    const sql = `
      SELECT *
      FROM report_subscriptions FINAL
      WHERE id = {id:String}
        AND user_id = {user_id:String}
        AND status != 'disabled'
      LIMIT 1
    `;

    const results = await this.clickhouse.querySystem<Subscription>(sql, {
      id,
      user_id: userId,
    });

    return results[0] ?? null;
  }

  async getById(id: string): Promise<Subscription | null> {
    const sql = `
      SELECT *
      FROM report_subscriptions FINAL
      WHERE id = {id:String}
        AND status != 'disabled'
      LIMIT 1
    `;

    const results = await this.clickhouse.querySystem<Subscription>(sql, {
      id,
    });

    return results[0] ?? null;
  }

  async update(
    dto: UpdateSubscriptionDto,
    userId: string,
  ): Promise<Subscription> {
    const existing = await this.get(dto.id, userId);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const workspace = await this.workspacesService.get(dto.workspace_id);

    const frequency = dto.frequency ?? existing.frequency;
    const hour = dto.hour ?? existing.hour;
    const dayOfWeek = dto.day_of_week ?? existing.day_of_week;
    const dayOfMonth = dto.day_of_month ?? existing.day_of_month;
    const subscriptionTimezone =
      dto.timezone ?? existing.timezone ?? workspace.timezone;

    const nextSendAt =
      existing.status === 'active'
        ? this.calculateNextSendAt(
            frequency,
            hour,
            dayOfWeek,
            dayOfMonth,
            subscriptionTimezone,
          )
        : undefined;

    const updated: Subscription = {
      ...existing,
      name: dto.name ?? existing.name,
      frequency,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth,
      hour,
      timezone: subscriptionTimezone,
      metrics: dto.metrics ?? existing.metrics,
      dimensions: dto.dimensions ?? existing.dimensions,
      filters:
        dto.filters !== undefined
          ? serializeFilters(dto.filters)
          : existing.filters,
      limit: dto.limit ?? existing.limit,
      next_send_at: nextSendAt,
      updated_at: toClickHouseDateTime(),
    };

    await this.insertSubscription(updated);
    return updated;
  }

  async pause(id: string, userId: string): Promise<Subscription> {
    const existing = await this.get(id, userId);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const updated: Subscription = {
      ...existing,
      status: 'paused',
      next_send_at: undefined,
      updated_at: toClickHouseDateTime(),
    };

    await this.insertSubscription(updated);
    return updated;
  }

  async resume(id: string, userId: string): Promise<Subscription> {
    const existing = await this.get(id, userId);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const nextSendAt = this.calculateNextSendAt(
      existing.frequency,
      existing.hour,
      existing.day_of_week,
      existing.day_of_month,
      existing.timezone,
    );

    const updated: Subscription = {
      ...existing,
      status: 'active',
      next_send_at: nextSendAt,
      updated_at: toClickHouseDateTime(),
    };

    await this.insertSubscription(updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.get(id, userId);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const updated: Subscription = {
      ...existing,
      status: 'disabled',
      next_send_at: undefined,
      updated_at: toClickHouseDateTime(),
    };

    await this.insertSubscription(updated);
  }

  async findDue(): Promise<Subscription[]> {
    const now = toClickHouseDateTime();
    const sql = `
      SELECT *
      FROM report_subscriptions FINAL
      WHERE next_send_at <= {now:String}
        AND status = 'active'
      ORDER BY next_send_at ASC
    `;

    return this.clickhouse.querySystem<Subscription>(sql, {
      now,
    });
  }

  async markSent(id: string): Promise<Subscription> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const nextSendAt = this.calculateNextSendAt(
      existing.frequency,
      existing.hour,
      existing.day_of_week,
      existing.day_of_month,
      existing.timezone,
    );

    const updated: Subscription = {
      ...existing,
      last_sent_at: toClickHouseDateTime(),
      last_send_status: 'success',
      last_error: '',
      next_send_at: nextSendAt,
      consecutive_failures: 0,
      updated_at: toClickHouseDateTime(),
    };

    await this.insertSubscription(updated);
    return updated;
  }

  async markFailed(id: string, error: string): Promise<Subscription> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const consecutiveFailures = existing.consecutive_failures + 1;
    const shouldDisable = consecutiveFailures >= 5;

    const updated: Subscription = {
      ...existing,
      last_send_status: 'failed',
      last_error: error,
      consecutive_failures: consecutiveFailures,
      status: shouldDisable ? 'disabled' : existing.status,
      updated_at: toClickHouseDateTime(),
    };

    await this.insertSubscription(updated);
    return updated;
  }

  private calculateNextSendAt(
    frequency: SubscriptionFrequency,
    hour: number,
    dayOfWeek?: number,
    dayOfMonth?: number,
    timezone = 'UTC',
  ): string {
    const now = dayjs().tz(timezone);
    let next = now.hour(hour).minute(0).second(0).millisecond(0);

    if (frequency === 'daily') {
      // If we've passed the hour today, schedule for tomorrow
      if (now.hour() >= hour) {
        next = next.add(1, 'day');
      }
    } else if (frequency === 'weekly' && dayOfWeek !== undefined) {
      // dayOfWeek: 1=Monday, 7=Sunday (convert to dayjs: 0=Sunday, 1=Monday, etc.)
      const targetDay = dayOfWeek === 7 ? 0 : dayOfWeek;
      next = next.day(targetDay);
      if (
        next.isBefore(now) ||
        (next.isSame(now, 'day') && now.hour() >= hour)
      ) {
        next = next.add(1, 'week');
      }
    } else if (frequency === 'monthly' && dayOfMonth !== undefined) {
      next = next.date(dayOfMonth);
      if (
        next.isBefore(now) ||
        (next.isSame(now, 'day') && now.hour() >= hour)
      ) {
        next = next.add(1, 'month');
      }
    }

    return next.utc().format('YYYY-MM-DD HH:mm:ss.SSS');
  }

  private async insertSubscription(subscription: Subscription): Promise<void> {
    await this.clickhouse.insertSystem('report_subscriptions', [subscription]);
  }
}
