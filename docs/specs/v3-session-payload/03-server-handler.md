# Phase 3: Server Handler

**Status**: Ready for Implementation
**Estimated Effort**: 1 day
**Dependencies**: Phase 1 (database schema), Phase 2 (DTOs)

## Overview

Transform session payload `actions[]` into flat event rows with server-side deduplication. The handler deserializes each action by type into a `TrackingEvent`, adds server metadata (`_version`), and inserts with deduplication.

**Note**: The new `track.session` endpoint coexists with existing `track` and `track.batch` endpoints. No legacy support - only new SDK uses this endpoint.

## Design Decisions

### Endpoint Design

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `POST /api/track` | Single event (legacy) | Keep (existing SDK) |
| `POST /api/track.batch` | Batch events (legacy) | Keep (existing SDK) |
| `POST /api/track.session` | Session payload (new) | **New** |

### Action to Event Mapping

| Action Type | Event Name | Key Fields |
|-------------|------------|------------|
| `pageview` | `screen_view` | page_number, page_duration, max_scroll, previous_path |
| `goal` | `goal` | goal_name, goal_value, properties |

### Deduplication Strategy

Primary deduplication is via checkpoint logic (SDK tracks acknowledged actions). As a fallback for network retries, we use a `dedup_token` column with deterministic tokens.

| Action Type | Dedup Token Pattern | Example |
|-------------|---------------------|---------|
| Pageview | `{session_id}_pv_{page_number}` | `sess123_pv_3` |
| Goal | `{session_id}_goal_{name}_{timestamp}` | `sess123_goal_signup_1704067200000` |

**Note**: The events table `id` is UUID (auto-generated). We use a separate `dedup_token String` column for our deterministic tokens. This column is added in Phase 1 migration.

### Checkpoint Logic

- SDK sends `checkpoint` = index of last acknowledged action
- Server skips actions at indices `<= checkpoint`
- Response includes new checkpoint for SDK to track

### current_page Handling

`current_page` represents an in-progress page (user still on it). Server ignores it - only finalized actions in `actions[]` are processed.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    POST /api/track.session                       │
│                         SessionPayloadDto                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SessionPayloadHandler                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Validate workspace                                           │
│  2. Extract session attributes (first payload only)              │
│  3. Filter actions by checkpoint                                 │
│  4. For each action:                                             │
│     - Switch on action.type                                      │
│     - Deserialize to TrackingEvent                               │
│     - Set _version = Date.now()                                  │
│     - Generate deterministic event ID                            │
│  5. Add events to buffer                                         │
│  6. Return new checkpoint                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EventBufferService                          │
│                    (unchanged from Phase 1)                      │
└─────────────────────────────────────────────────────────────────┘
```

## Test Specifications (TDD)

### Test Setup

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SessionPayloadHandler } from './session-payload.handler';
import { EventBufferService } from './event-buffer.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { GeoService } from '../geo/geo.service';
import { EMPTY_GEO } from '../geo/geo.interface';
import { SessionPayloadDto, PageviewActionDto, GoalActionDto } from './dto/session-payload.dto';

describe('SessionPayloadHandler', () => {
  let handler: SessionPayloadHandler;
  let bufferService: jest.Mocked<EventBufferService>;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let geoService: jest.Mocked<GeoService>;

  const mockWorkspace = {
    id: 'test-ws',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    status: 'active',
    settings: {
      timescore_reference: 180,
      bounce_threshold: 10,
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
      filters: [],
    },
  };

  const createPayload = (overrides: Partial<SessionPayloadDto> = {}): SessionPayloadDto => ({
    workspace_id: 'test-ws',
    session_id: 'sess-123',
    actions: [],
    created_at: Date.now() - 10000,
    updated_at: Date.now(),
    ...overrides,
  });

  const createPageviewAction = (overrides: Partial<PageviewActionDto> = {}): PageviewActionDto => ({
    type: 'pageview',
    path: '/home',
    page_number: 1,
    duration: 5000,
    scroll: 50,
    entered_at: Date.now() - 5000,
    exited_at: Date.now(),
    ...overrides,
  });

  const createGoalAction = (overrides: Partial<GoalActionDto> = {}): GoalActionDto => ({
    type: 'goal',
    name: 'signup',
    path: '/register',
    page_number: 2,
    timestamp: Date.now(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionPayloadHandler,
        {
          provide: EventBufferService,
          useValue: { addBatch: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WorkspacesService,
          useValue: { get: jest.fn().mockResolvedValue(mockWorkspace) },
        },
        {
          provide: GeoService,
          useValue: { lookupWithSettings: jest.fn().mockReturnValue(EMPTY_GEO) },
        },
      ],
    }).compile();

    handler = module.get<SessionPayloadHandler>(SessionPayloadHandler);
    bufferService = module.get(EventBufferService);
    workspacesService = module.get(WorkspacesService);
    geoService = module.get(GeoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
```

### Test 1: Basic pageview deserialization

```typescript
describe('pageview deserialization', () => {
  it('converts pageview action to screen_view event', async () => {
    const payload = createPayload({
      actions: [createPageviewAction({ path: '/about', page_number: 2 })],
      attributes: { landing_page: 'https://example.com/home' },
    });

    await handler.handle(payload, '8.8.8.8');

    expect(bufferService.addBatch).toHaveBeenCalledTimes(1);
    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      session_id: 'sess-123',
      workspace_id: 'test-ws',
      name: 'screen_view',
      path: '/about',
      page_number: 2,
      page_duration: 5000,
      max_scroll: 50,
    });
  });

  it('sets previous_path from prior pageview', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ path: '/home', page_number: 1 }),
        createPageviewAction({ path: '/about', page_number: 2 }),
      ],
      attributes: { landing_page: 'https://example.com/home' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].previous_path).toBe('');        // First page has no previous
    expect(events[1].previous_path).toBe('/home');   // Second page's previous is first
  });

  it('converts duration from ms to seconds for page_duration', async () => {
    const payload = createPayload({
      actions: [createPageviewAction({ duration: 5500 })],  // 5.5 seconds in ms
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].page_duration).toBe(5500);  // Keep as ms, matches schema
  });
});
```

### Test 2: Goal deserialization

```typescript
describe('goal deserialization', () => {
  it('converts goal action to goal event', async () => {
    const timestamp = Date.now();
    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createGoalAction({ name: 'purchase', value: 99.99, timestamp, page_number: 7 }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events).toHaveLength(2);

    const goalEvent = events[1];
    expect(goalEvent).toMatchObject({
      name: 'goal',
      goal_name: 'purchase',
      goal_value: 99.99,
      page_number: 7,  // Explicitly set, verifies mapping from action
    });
  });

  it('includes goal properties in event properties', async () => {
    const payload = createPayload({
      actions: [
        createGoalAction({
          name: 'checkout',
          properties: { plan: 'premium', source: 'banner' },
        }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].properties).toEqual({ plan: 'premium', source: 'banner' });
  });

  it('sets goal_value to 0 when not provided', async () => {
    const payload = createPayload({
      actions: [createGoalAction({ name: 'signup' })],  // No value
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].goal_value).toBe(0);
  });
});
```

### Test 3: Server timestamp (_version)

```typescript
describe('_version timestamp', () => {
  it('sets _version to current server time on all events', async () => {
    const beforeTime = Date.now();

    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createGoalAction({ name: 'signup' }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const afterTime = Date.now();
    const events = bufferService.addBatch.mock.calls[0][0];

    for (const event of events) {
      expect(event._version).toBeGreaterThanOrEqual(beforeTime);
      expect(event._version).toBeLessThanOrEqual(afterTime);
    }
  });

  it('all events in same payload have same _version', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createPageviewAction({ page_number: 2 }),
        createGoalAction({ name: 'signup' }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    const versions = events.map(e => e._version);
    expect(new Set(versions).size).toBe(1);  // All same version
  });
});
```

### Test 4: Checkpoint logic

```typescript
describe('checkpoint handling', () => {
  it('skips actions at or before checkpoint', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ path: '/page1', page_number: 1 }),  // index 0
        createPageviewAction({ path: '/page2', page_number: 2 }),  // index 1
        createPageviewAction({ path: '/page3', page_number: 3 }),  // index 2
        createGoalAction({ name: 'signup' }),                       // index 3
      ],
      checkpoint: 1,  // Skip indices 0 and 1
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events).toHaveLength(2);  // Only page3 and signup
    expect(events[0].path).toBe('/page3');
    expect(events[1].name).toBe('goal');
  });

  it('returns new checkpoint equal to actions length', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createPageviewAction({ page_number: 2 }),
        createGoalAction({ name: 'signup' }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    const result = await handler.handle(payload, null);

    expect(result.checkpoint).toBe(3);  // Total actions processed
  });

  it('returns checkpoint 0 for empty actions', async () => {
    const payload = createPayload({ actions: [] });

    const result = await handler.handle(payload, null);

    expect(result.checkpoint).toBe(0);
    expect(bufferService.addBatch).not.toHaveBeenCalled();
  });

  it('handles checkpoint equal to actions length (no new actions)', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createPageviewAction({ page_number: 2 }),
      ],
      checkpoint: 2,  // All actions already processed
      attributes: { landing_page: 'https://example.com/' },
    });

    const result = await handler.handle(payload, null);

    expect(result.checkpoint).toBe(2);
    expect(bufferService.addBatch).not.toHaveBeenCalled();
  });

  it('builds previous_path chain from all actions including skipped', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ path: '/page1', page_number: 1 }),  // index 0 - skipped
        createPageviewAction({ path: '/page2', page_number: 2 }),  // index 1 - skipped
        createPageviewAction({ path: '/page3', page_number: 3 }),  // index 2 - processed
      ],
      checkpoint: 1,  // Skip indices 0 and 1
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events).toHaveLength(1);
    // previous_path should be /page2 (from skipped action at index 1)
    expect(events[0].previous_path).toBe('/page2');
  });
});
```

### Test 5: current_page handling

```typescript
describe('current_page handling', () => {
  it('ignores current_page (not finalized)', async () => {
    const payload = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      current_page: {
        path: '/in-progress',
        page_number: 2,
        entered_at: Date.now(),
        scroll: 25,
      },
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events).toHaveLength(1);  // Only the action, not current_page
    expect(events[0].path).toBe('/home');  // From the action, not /in-progress
  });
});
```

### Test 6: Session attributes

```typescript
describe('session attributes', () => {
  it('applies session attributes to all events', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createGoalAction({ name: 'signup' }),
      ],
      attributes: {
        landing_page: 'https://example.com/landing',
        referrer: 'https://google.com/search',
        utm_source: 'google',
        utm_medium: 'cpc',
        browser: 'Chrome',
        os: 'macOS',
        screen_width: 1920,
        screen_height: 1080,
      },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    for (const event of events) {
      expect(event.landing_page).toBe('https://example.com/landing');
      expect(event.referrer).toBe('https://google.com/search');
      expect(event.utm_source).toBe('google');
      expect(event.browser).toBe('Chrome');
      expect(event.screen_width).toBe(1920);
    }
  });

  it('derives referrer_domain and landing_domain from URLs', async () => {
    const payload = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      attributes: {
        landing_page: 'https://example.com/products/item?id=123',
        referrer: 'https://google.com/search?q=test',
      },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].landing_domain).toBe('example.com');
    expect(events[0].landing_path).toBe('/products/item');
    expect(events[0].referrer_domain).toBe('google.com');
    expect(events[0].referrer_path).toBe('/search');
  });

  it('sets is_direct based on referrer presence', async () => {
    // With referrer
    const payloadWithRef = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      attributes: {
        landing_page: 'https://example.com/',
        referrer: 'https://google.com/',
      },
    });
    await handler.handle(payloadWithRef, null);
    expect(bufferService.addBatch.mock.calls[0][0][0].is_direct).toBe(false);

    bufferService.addBatch.mockClear();

    // Without referrer
    const payloadDirect = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      attributes: { landing_page: 'https://example.com/' },
    });
    await handler.handle(payloadDirect, null);
    expect(bufferService.addBatch.mock.calls[0][0][0].is_direct).toBe(true);
  });
});
```

### Test 7: Geo lookup

```typescript
describe('geo lookup', () => {
  it('applies geo data from IP lookup', async () => {
    geoService.lookupWithSettings.mockReturnValue({
      country: 'US',
      region: 'California',
      city: 'San Francisco',
      latitude: 37.77,
      longitude: -122.42,
    });

    const payload = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, '8.8.8.8');

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].country).toBe('US');
    expect(events[0].region).toBe('California');
    expect(events[0].city).toBe('San Francisco');
    expect(events[0].latitude).toBe(37.77);
    expect(events[0].longitude).toBe(-122.42);
  });

  it('performs geo lookup once per payload', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ page_number: 1 }),
        createPageviewAction({ page_number: 2 }),
        createGoalAction({ name: 'signup' }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, '8.8.8.8');

    expect(geoService.lookupWithSettings).toHaveBeenCalledTimes(1);
  });
});
```

### Test 8: Dedup token generation

```typescript
describe('dedup token generation', () => {
  it('generates deterministic pageview dedup_token', async () => {
    const payload = createPayload({
      session_id: 'sess-abc',
      actions: [createPageviewAction({ page_number: 5 })],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    // Pageview token format: {session_id}_pv_{page_number}
    expect(events[0].dedup_token).toBe('sess-abc_pv_5');
  });

  it('generates deterministic goal dedup_token', async () => {
    const timestamp = 1704067200000;
    const payload = createPayload({
      session_id: 'sess-xyz',
      actions: [createGoalAction({ name: 'purchase', timestamp })],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    // Goal token format: {session_id}_goal_{name}_{timestamp}
    expect(events[0].dedup_token).toBe('sess-xyz_goal_purchase_1704067200000');
  });

  it('same payload produces same dedup_tokens (idempotent)', async () => {
    const payload = createPayload({
      session_id: 'sess-test',
      actions: [
        createPageviewAction({ page_number: 1 }),
        createGoalAction({ name: 'signup', timestamp: 1704067200000 }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    // Process same payload twice
    await handler.handle(payload, null);
    await handler.handle(payload, null);

    const events1 = bufferService.addBatch.mock.calls[0][0];
    const events2 = bufferService.addBatch.mock.calls[1][0];

    expect(events1[0].dedup_token).toBe(events2[0].dedup_token);
    expect(events1[1].dedup_token).toBe(events2[1].dedup_token);
  });
});
```

### Test 9: Error handling

```typescript
describe('error handling', () => {
  it('throws BadRequestException for invalid workspace', async () => {
    workspacesService.get.mockRejectedValue(new Error('Not found'));

    const payload = createPayload({ workspace_id: 'invalid-ws' });

    await expect(handler.handle(payload, null)).rejects.toThrow('Invalid workspace_id');
  });

  it('handles empty attributes gracefully', async () => {
    const payload = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      // No attributes
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].landing_page).toBe('');
    expect(events[0].referrer).toBe('');
  });
});
```

### Test 10: Filter application

```typescript
describe('filter application', () => {
  it('applies workspace filters to events', async () => {
    // Setup workspace with filters
    const workspaceWithFilters = {
      ...mockWorkspace,
      settings: {
        ...mockWorkspace.settings,
        filters: [
          {
            id: 'filter-1',
            name: 'UTM Override',
            priority: 1,
            conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
            actions: [{ type: 'set_custom_dimension', dimension: 'stm_1', value: 'paid' }],
          },
        ],
      },
    };
    workspacesService.get.mockResolvedValue(workspaceWithFilters);

    const payload = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      attributes: {
        landing_page: 'https://example.com/',
        utm_source: 'google',
      },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].stm_1).toBe('paid');
  });

  it('does not apply filters when none configured', async () => {
    const payload = createPayload({
      actions: [createPageviewAction({ page_number: 1 })],
      attributes: {
        landing_page: 'https://example.com/',
        utm_source: 'google',
      },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events[0].stm_1).toBe('');  // No filter applied
  });
});
// Close main describe
});
```

## Implementation

### File: `api/src/events/session-payload.handler.ts`

```typescript
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventBufferService } from './event-buffer.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { GeoService } from '../geo/geo.service';
import { GeoLocation } from '../geo/geo.interface';
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

interface HandleResult {
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
    const baseEvent = this.buildBaseEvent(payload, workspace, geo, version);

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
    workspace: Workspace,
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
      return this.deserializePageview(action, baseEvent, sessionId, previousPath);
    } else if (isGoalAction(action)) {
      return this.deserializeGoal(action, baseEvent, sessionId);
    }

    // Exhaustive check - should never reach here
    throw new Error(`Unknown action type: ${(action as any).type}`);
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

  private applyFilters(event: TrackingEvent, filters: any[]): void {
    const fieldValues = extractFieldValues(
      event as unknown as Record<string, unknown>,
    );
    const { customDimensions, modifiedFields } = applyFilterResults(
      filters,
      fieldValues,
      event as unknown as Record<string, unknown>,
    );

    Object.assign(event, customDimensions);

    for (const [field, value] of Object.entries(modifiedFields)) {
      if (field === 'is_direct') {
        (event as any)[field] = value === 'true';
      } else {
        (event as any)[field] = value;
      }
    }
  }
}
```

### File: `api/src/events/entities/event.entity.ts` (update)

Add the new fields to the TrackingEvent interface:

```typescript
export interface TrackingEvent {
  // ... existing fields ...

  // V3 Session Payload fields
  dedup_token?: string;  // Deterministic token for deduplication (not the UUID id)
  page_number?: number;  // Page sequence within session
  _version?: number;     // Server timestamp for conflict resolution
  goal_name?: string;    // Goal identifier
  goal_value?: number;   // Goal value (e.g., purchase amount)
}
```

**Note**: The `id` field remains UUID (auto-generated by ClickHouse). `dedup_token` is a separate String column added in Phase 1 migration.

### File: `api/src/events/events.controller.ts` (update)

Add the new endpoint:

```typescript
import { SessionPayloadDto } from './dto/session-payload.dto';
import { SessionPayloadHandler } from './session-payload.handler';

@Controller('api')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly sessionPayloadHandler: SessionPayloadHandler,
  ) {}

  // ... existing endpoints ...

  @Post('track.session')
  @HttpCode(200)
  @UseGuards(AuthGuard('api-key'), ScopeGuard, WorkspaceGuard)
  @RequireScope('events.track')
  @ApiOperation({ summary: 'Track session with actions array' })
  async trackSession(
    @Body() payload: SessionPayloadDto,
    @ClientIp() clientIp: string | null,
  ) {
    return this.sessionPayloadHandler.handle(payload, clientIp);
  }
}
```

### File: `api/src/events/events.module.ts` (update)

Register the new handler:

```typescript
import { SessionPayloadHandler } from './session-payload.handler';

@Module({
  // ...
  providers: [
    EventsService,
    EventBufferService,
    SessionPayloadHandler,  // Add this
  ],
})
export class EventsModule {}
```

## API Response

```typescript
// Success response
{
  "success": true,
  "checkpoint": 5  // Number of actions processed (SDK stores this)
}

// Error response (validation failed)
{
  "statusCode": 400,
  "message": ["actions.0.page_number must be >= 1"],
  "error": "Bad Request"
}
```

## Checklist

- [ ] Verify Phase 1 migration includes `dedup_token` column (dependency)
- [ ] Verify Phase 2 DTOs are implemented (dependency)
- [ ] Create `api/src/events/session-payload.handler.ts`
- [ ] Create `api/src/events/session-payload.handler.spec.ts` with all tests
- [ ] Update `api/src/events/entities/event.entity.ts` with new fields (dedup_token, page_number, _version, goal_name, goal_value)
- [ ] Update `api/src/events/events.controller.ts` with `track.session` endpoint
- [ ] Update `api/src/events/events.module.ts` to register handler
- [ ] Run tests: `npm test -- session-payload.handler`
- [ ] Test endpoint manually with sample payload
- [ ] Verify events appear in ClickHouse with correct fields
- [ ] Verify dedup_token is set correctly for pageviews and goals
- [ ] Verify checkpoint logic skips already-processed actions
- [ ] Verify previous_path is built correctly with checkpoint
- [ ] Verify workspace cache invalidation on filter changes
