import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { TrackingEvent } from './entities/event.entity';

const MAX_BUFFER_SIZE = 500;
const FLUSH_INTERVAL_MS = 2000;

@Injectable()
export class EventBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBufferService.name);
  private buffer: TrackingEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(private readonly clickhouse: ClickHouseService) {}

  async onModuleDestroy() {
    this.stopFlushTimer();
    await this.flush();
    this.logger.log('Event buffer destroyed, final flush complete');
  }

  async add(event: TrackingEvent): Promise<void> {
    this.buffer.push(event);

    // Start timer on first event
    if (this.buffer.length === 1) {
      this.startFlushTimer();
    }

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      await this.flush();
    }
  }

  async addBatch(events: TrackingEvent[]): Promise<void> {
    const wasEmpty = this.buffer.length === 0;
    this.buffer.push(...events);

    // Start timer if buffer was empty
    if (wasEmpty && this.buffer.length > 0) {
      this.startFlushTimer();
    }

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      await this.flush();
    }
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return; // Already running

    this.flushTimer = setTimeout(() => {
      this.flush().catch((err) => {
        this.logger.error('Flush timer error:', err);
      });
    }, FLUSH_INTERVAL_MS);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flush(): Promise<void> {
    this.stopFlushTimer(); // Clear timer on flush

    if (this.buffer.length === 0 || this.isFlushing) {
      return;
    }

    this.isFlushing = true;
    const eventsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      await this.clickhouse.insert('events', eventsToFlush);
      this.logger.debug(`Flushed ${eventsToFlush.length} events to ClickHouse`);
    } catch (error) {
      // Re-add failed events to buffer (at front for retry)
      this.buffer = [...eventsToFlush, ...this.buffer];
      this.logger.error('Failed to flush events:', error);
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }
}
