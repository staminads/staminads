import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { TrackingEvent } from './entities/event.entity';

const MAX_BUFFER_SIZE = 500;
const FLUSH_INTERVAL_MS = 2000;

@Injectable()
export class EventBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBufferService.name);
  // Per-workspace buffers
  private buffers = new Map<string, TrackingEvent[]>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private flushingWorkspaces = new Set<string>();

  constructor(private readonly clickhouse: ClickHouseService) {}

  async onModuleDestroy() {
    // Stop all timers
    for (const [workspaceId] of this.flushTimers) {
      this.stopFlushTimer(workspaceId);
    }

    // Flush all workspace buffers
    const flushPromises: Promise<void>[] = [];
    for (const workspaceId of this.buffers.keys()) {
      flushPromises.push(this.flush(workspaceId));
    }
    await Promise.all(flushPromises);

    this.logger.log('Event buffer destroyed, final flush complete');
  }

  async add(event: TrackingEvent): Promise<void> {
    const workspaceId = event.workspace_id;

    if (!this.buffers.has(workspaceId)) {
      this.buffers.set(workspaceId, []);
    }

    const buffer = this.buffers.get(workspaceId)!;
    buffer.push(event);

    // Start timer on first event for this workspace
    if (buffer.length === 1) {
      this.startFlushTimer(workspaceId);
    }

    if (buffer.length >= MAX_BUFFER_SIZE) {
      await this.flush(workspaceId);
    }
  }

  async addBatch(events: TrackingEvent[]): Promise<void> {
    // Group events by workspace
    const byWorkspace = new Map<string, TrackingEvent[]>();
    for (const event of events) {
      const workspaceId = event.workspace_id;
      if (!byWorkspace.has(workspaceId)) {
        byWorkspace.set(workspaceId, []);
      }
      byWorkspace.get(workspaceId)!.push(event);
    }

    // Add each group to its workspace buffer
    for (const [workspaceId, workspaceEvents] of byWorkspace) {
      for (const event of workspaceEvents) {
        await this.add(event);
      }
    }
  }

  getBufferSize(workspaceId?: string): number {
    if (workspaceId) {
      return this.buffers.get(workspaceId)?.length ?? 0;
    }
    // Return total size across all workspaces
    let total = 0;
    for (const buffer of this.buffers.values()) {
      total += buffer.length;
    }
    return total;
  }

  private startFlushTimer(workspaceId: string): void {
    if (this.flushTimers.has(workspaceId)) return; // Already running

    const timer = setTimeout(() => {
      this.flush(workspaceId).catch((err) => {
        this.logger.error(
          `Flush timer error for workspace ${workspaceId}:`,
          err,
        );
      });
    }, FLUSH_INTERVAL_MS);

    this.flushTimers.set(workspaceId, timer);
  }

  private stopFlushTimer(workspaceId: string): void {
    const timer = this.flushTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(workspaceId);
    }
  }

  async flush(workspaceId: string): Promise<void> {
    this.stopFlushTimer(workspaceId); // Clear timer on flush

    const buffer = this.buffers.get(workspaceId);
    if (
      !buffer ||
      buffer.length === 0 ||
      this.flushingWorkspaces.has(workspaceId)
    ) {
      return;
    }

    this.flushingWorkspaces.add(workspaceId);
    const eventsToFlush = [...buffer];
    this.buffers.set(workspaceId, []);

    try {
      // Insert to workspace-specific database
      await this.clickhouse.insertWorkspace(
        workspaceId,
        'events',
        eventsToFlush,
      );
      this.logger.debug(
        `Flushed ${eventsToFlush.length} events to workspace ${workspaceId}`,
      );
    } catch (error) {
      // Re-add failed events to buffer (at front for retry)
      const currentBuffer = this.buffers.get(workspaceId) || [];
      this.buffers.set(workspaceId, [...eventsToFlush, ...currentBuffer]);
      this.logger.error(
        `Failed to flush events for workspace ${workspaceId}:`,
        error,
      );
      throw error;
    } finally {
      this.flushingWorkspaces.delete(workspaceId);
    }
  }

  /**
   * Flush all workspace buffers.
   * Used primarily for testing and graceful shutdown.
   */
  async flushAll(): Promise<void> {
    const workspaceIds = [...this.buffers.keys()];
    for (const workspaceId of workspaceIds) {
      await this.flush(workspaceId);
    }
  }
}
