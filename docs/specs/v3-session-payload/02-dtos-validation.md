# Phase 2: DTOs & Validation

**Status**: Ready for Implementation
**Estimated Effort**: 0.5 day
**Dependencies**: Phase 1 (database schema)

## Overview

Define TypeScript interfaces and validation for the session payload with `actions[]` array. Uses class-validator decorators following existing codebase patterns.

**Note**: These DTOs extend the existing V3 tracking system. The new `SessionPayloadDto` will coexist with the current `TrackEventDto` during migration.

## Design Decisions

### Discriminated Union for Actions

Actions use a `type` field discriminator:
- `type: 'pageview'` → PageviewAction
- `type: 'goal'` → GoalAction
- Future: `'click'`, `'custom'`, etc.

This pattern allows:
- Type-safe handling with exhaustive switch/case
- Easy extension for new action types
- Single validation path for all actions

### Validation Strategy

| Concern | Approach |
|---------|----------|
| Array size | `MAX_ACTIONS = 1000` (prevents payload bombs) |
| Timestamp bounds | ±24 hours from server time (rejects stale/future data) |
| String lengths | `path` max 2048, `goal_name` max 100 |
| Nested validation | `@ValidateNested({ each: true })` for actions array |

### Timestamp Handling

All timestamps from SDK are epoch milliseconds (`number`). Server converts to ClickHouse `DateTime64(3)` on insert.

### Server-Derived Fields (Not in DTO)

These fields are computed server-side from the raw input:
- `referrer_domain`, `referrer_path` - parsed from `referrer` URL
- `landing_domain`, `landing_path` - parsed from `landing_page` URL
- `is_direct` - derived from referrer presence

## Type Definitions

### Action Types

```typescript
// api/src/events/dto/session-payload.dto.ts

type ActionType = 'pageview' | 'goal';

interface BaseAction {
  type: ActionType;
  path: string;
  page_number: number;
}

interface PageviewAction extends BaseAction {
  type: 'pageview';
  duration: number;      // milliseconds on page
  scroll: number;        // max scroll percentage (0-100)
  entered_at: number;    // epoch ms when page was entered
  exited_at: number;     // epoch ms when page was left
}

interface GoalAction extends BaseAction {
  type: 'goal';
  name: string;          // goal identifier
  value?: number;        // optional numeric value (e.g., purchase amount)
  timestamp: number;     // epoch ms when goal was completed
  properties?: Record<string, string>;  // optional metadata
}

type Action = PageviewAction | GoalAction;
```

### Session Payload

```typescript
interface CurrentPage {
  path: string;
  page_number: number;
  entered_at: number;
  scroll: number;
}

interface SessionPayload {
  // Identity
  workspace_id: string;
  session_id: string;

  // Actions (cumulative)
  actions: Action[];

  // Current page state (not yet finalized)
  current_page?: CurrentPage;

  // Checkpoint for long sessions
  checkpoint?: number;  // index of last acknowledged action

  // Session attributes (sent once, on first payload)
  attributes?: SessionAttributes;

  // Timestamps
  created_at: number;   // session start (epoch ms)
  updated_at: number;   // last activity (epoch ms)

  // SDK metadata
  sdk_version?: string;
}

interface SessionAttributes {
  // Traffic source
  referrer?: string;
  landing_page: string;

  // UTM parameters
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
  utm_id_from?: string;

  // Device info
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device?: string;
  browser?: string;
  browser_type?: string;
  os?: string;
  user_agent?: string;
  connection_type?: string;
  language?: string;
  timezone?: string;
}
```

## Test Specifications (TDD)

### Test 1: PageviewAction validation

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PageviewActionDto, GoalActionDto, SessionPayloadDto } from './session-payload.dto';

describe('PageviewActionDto', () => {
  const validPageview = {
    type: 'pageview',
    path: '/home',
    page_number: 1,
    duration: 5000,
    scroll: 75,
    entered_at: Date.now() - 5000,
    exited_at: Date.now(),
  };

  it('accepts valid pageview action', async () => {
    const dto = plainToInstance(PageviewActionDto, validPageview);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects pageview without required fields', async () => {
    const dto = plainToInstance(PageviewActionDto, { type: 'pageview' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    const errorFields = errors.map(e => e.property);
    expect(errorFields).toContain('path');
    expect(errorFields).toContain('page_number');
    expect(errorFields).toContain('duration');
  });

  it('rejects scroll outside 0-100 range', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      scroll: 150,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'scroll')).toBe(true);
  });

  it('rejects negative duration', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      duration: -100,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'duration')).toBe(true);
  });

  it('rejects page_number less than 1', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      page_number: 0,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'page_number')).toBe(true);
  });

  it('rejects path longer than 2048 characters', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      path: '/' + 'a'.repeat(2048),  // 2049 chars total
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'path')).toBe(true);
  });
});
```

### Test 2: GoalAction validation

```typescript
describe('GoalActionDto', () => {
  const validGoal = {
    type: 'goal',
    name: 'signup',
    path: '/register',
    page_number: 2,
    timestamp: Date.now(),
  };

  it('accepts valid goal action', async () => {
    const dto = plainToInstance(GoalActionDto, validGoal);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts goal with optional value', async () => {
    const dto = plainToInstance(GoalActionDto, {
      ...validGoal,
      value: 99.99,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts goal with optional properties', async () => {
    const dto = plainToInstance(GoalActionDto, {
      ...validGoal,
      properties: { plan: 'premium', source: 'checkout' },
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects goal without name', async () => {
    const dto = plainToInstance(GoalActionDto, {
      type: 'goal',
      path: '/checkout',
      page_number: 1,
      timestamp: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('rejects goal_name longer than 100 characters', async () => {
    const dto = plainToInstance(GoalActionDto, {
      ...validGoal,
      name: 'a'.repeat(101),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('rejects negative goal value', async () => {
    const dto = plainToInstance(GoalActionDto, {
      ...validGoal,
      value: -10,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'value')).toBe(true);
  });
});
```

### Test 3: SessionPayload validation

```typescript
describe('SessionPayloadDto', () => {
  const validPayload = {
    workspace_id: 'ws-test',
    session_id: 'sess-123',
    actions: [
      {
        type: 'pageview',
        path: '/home',
        page_number: 1,
        duration: 5000,
        scroll: 50,
        entered_at: Date.now() - 10000,
        exited_at: Date.now() - 5000,
      },
    ],
    created_at: Date.now() - 10000,
    updated_at: Date.now(),
  };

  it('accepts valid session payload', async () => {
    const dto = plainToInstance(SessionPayloadDto, validPayload);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts payload with empty actions array', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      ...validPayload,
      actions: [],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts payload with current_page', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      ...validPayload,
      current_page: {
        path: '/about',
        page_number: 2,
        entered_at: Date.now(),
        scroll: 25,
      },
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts payload with checkpoint', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      ...validPayload,
      checkpoint: 5,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects payload without workspace_id', async () => {
    const { workspace_id, ...payloadWithoutWorkspace } = validPayload;
    const dto = plainToInstance(SessionPayloadDto, payloadWithoutWorkspace);
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'workspace_id')).toBe(true);
  });

  it('rejects payload without session_id', async () => {
    const { session_id, ...payloadWithoutSession } = validPayload;
    const dto = plainToInstance(SessionPayloadDto, payloadWithoutSession);
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'session_id')).toBe(true);
  });

  it('rejects payload with more than MAX_ACTIONS', async () => {
    const tooManyActions = Array(1001).fill(null).map((_, i) => ({
      type: 'pageview',
      path: `/page-${i}`,
      page_number: i + 1,
      duration: 1000,
      scroll: 50,
      entered_at: Date.now() - 1000,
      exited_at: Date.now(),
    }));

    const dto = plainToInstance(SessionPayloadDto, {
      ...validPayload,
      actions: tooManyActions,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'actions')).toBe(true);
  });
});
```

### Test 4: Nested action validation

```typescript
describe('SessionPayloadDto - Nested Action Validation', () => {
  it('validates nested pageview actions', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [
        {
          type: 'pageview',
          path: '/home',
          page_number: 0,  // Invalid: must be >= 1
          duration: -100,  // Invalid: must be >= 0
          scroll: 150,     // Invalid: must be <= 100
          entered_at: Date.now(),
          exited_at: Date.now(),
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    // Should have nested validation errors
    expect(errors.some(e => e.property === 'actions')).toBe(true);
    const actionsError = errors.find(e => e.property === 'actions');
    expect(actionsError?.children?.length).toBeGreaterThan(0);
  });

  it('validates nested goal actions', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [
        {
          type: 'goal',
          // Missing required: name, path, page_number, timestamp
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'actions')).toBe(true);
  });

  it('validates mixed action types', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [
        {
          type: 'pageview',
          path: '/home',
          page_number: 1,
          duration: 5000,
          scroll: 50,
          entered_at: Date.now() - 5000,
          exited_at: Date.now(),
        },
        {
          type: 'goal',
          name: 'signup',
          path: '/home',
          page_number: 1,
          timestamp: Date.now(),
          value: 0,
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
```

### Test 5: Timestamp bounds validation

```typescript
describe('SessionPayloadDto - Timestamp Bounds', () => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  it('rejects created_at more than 24 hours in the past', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now - TWENTY_FOUR_HOURS_MS - 1000,  // 24h + 1s ago
      updated_at: now,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'created_at')).toBe(true);
  });

  it('rejects created_at more than 24 hours in the future', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now + TWENTY_FOUR_HOURS_MS + 1000,  // 24h + 1s from now
      updated_at: now + TWENTY_FOUR_HOURS_MS + 1000,
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'created_at')).toBe(true);
  });

  it('rejects updated_at more than 24 hours in the past', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now - TWENTY_FOUR_HOURS_MS - 1000,
      updated_at: now - TWENTY_FOUR_HOURS_MS - 1000,  // 24h + 1s ago
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'updated_at')).toBe(true);
  });

  it('rejects updated_at more than 24 hours in the future', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now,
      updated_at: now + TWENTY_FOUR_HOURS_MS + 1000,  // 24h + 1s from now
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'updated_at')).toBe(true);
  });

  it('accepts timestamps within valid range', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now - 3600000,  // 1 hour ago
      updated_at: now,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
```

### Test 6: SessionAttributes validation

```typescript
describe('SessionAttributesDto', () => {
  it('accepts valid session attributes', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      attributes: {
        landing_page: 'https://example.com/landing',
        referrer: 'https://google.com/search',
        utm_source: 'google',
        utm_medium: 'cpc',
        screen_width: 1920,
        screen_height: 1080,
        browser: 'Chrome',
        os: 'macOS',
      },
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('requires landing_page when attributes provided', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      attributes: {
        utm_source: 'google',
        // Missing required: landing_page
      },
    });
    const errors = await validate(dto);

    // Should have nested validation error for attributes
    expect(errors.some(e => e.property === 'attributes')).toBe(true);
  });
});
```

### Test 7: Action type discrimination

```typescript
describe('Action Type Discrimination', () => {
  it('correctly identifies pageview action type', () => {
    const action = {
      type: 'pageview' as const,
      path: '/home',
      page_number: 1,
      duration: 5000,
      scroll: 50,
      entered_at: Date.now(),
      exited_at: Date.now(),
    };

    expect(isPageviewAction(action)).toBe(true);
    expect(isGoalAction(action)).toBe(false);
  });

  it('correctly identifies goal action type', () => {
    const action = {
      type: 'goal' as const,
      name: 'purchase',
      path: '/checkout',
      page_number: 3,
      timestamp: Date.now(),
      value: 99.99,
    };

    expect(isGoalAction(action)).toBe(true);
    expect(isPageviewAction(action)).toBe(false);
  });
});

// Type guard functions (to be implemented)
function isPageviewAction(action: Action): action is PageviewAction {
  return action.type === 'pageview';
}

function isGoalAction(action: Action): action is GoalAction {
  return action.type === 'goal';
}
```

### Test 8: Edge cases and error handling

```typescript
describe('SessionPayloadDto - Edge Cases', () => {
  it('rejects empty workspace_id', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: '',
      session_id: 'sess-123',
      actions: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'workspace_id')).toBe(true);
  });

  it('rejects empty session_id', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: '',
      actions: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'session_id')).toBe(true);
  });

  it('rejects unknown action type', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [
        {
          type: 'unknown',
          path: '/home',
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'actions')).toBe(true);
  });

  it('rejects non-array actions', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: 'not-an-array',
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'actions')).toBe(true);
  });
});
```

### Test 9: Pageview timestamp ordering

```typescript
describe('PageviewActionDto - Timestamp Ordering', () => {
  it('rejects exited_at before entered_at', async () => {
    const now = Date.now();
    const dto = plainToInstance(PageviewActionDto, {
      type: 'pageview',
      path: '/home',
      page_number: 1,
      duration: 5000,
      scroll: 50,
      entered_at: now,
      exited_at: now - 1000,  // Before entered_at
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'exited_at')).toBe(true);
  });

  it('accepts exited_at equal to entered_at (instant bounce)', async () => {
    const now = Date.now();
    const dto = plainToInstance(PageviewActionDto, {
      type: 'pageview',
      path: '/home',
      page_number: 1,
      duration: 0,
      scroll: 0,
      entered_at: now,
      exited_at: now,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
```

## DTO Implementation

### File: `api/src/events/dto/session-payload.dto.ts`

```typescript
import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
  IsIn,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  Validate,
} from 'class-validator';
import { IsWithinTimeBounds } from '../../common/validators/time-bounds.validator';
import { IsGreaterThanOrEqual } from '../../common/validators/compare.validator';

// Constants
export const MAX_ACTIONS = 1000;
export const MAX_PATH_LENGTH = 2048;
export const MAX_GOAL_NAME_LENGTH = 100;
export const TIMESTAMP_BOUNDS_HOURS = 24;

// === Action DTOs ===

export class PageviewActionDto {
  @IsIn(['pageview'])
  type: 'pageview';

  @IsString()
  @MaxLength(MAX_PATH_LENGTH)
  path: string;

  @IsNumber()
  @Min(1)
  page_number: number;

  @IsNumber()
  @Min(0)
  duration: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  scroll: number;

  @IsNumber()
  entered_at: number;

  @IsNumber()
  @IsGreaterThanOrEqual('entered_at', {
    message: 'exited_at must be greater than or equal to entered_at',
  })
  exited_at: number;
}

export class GoalActionDto {
  @IsIn(['goal'])
  type: 'goal';

  @IsString()
  @MaxLength(MAX_GOAL_NAME_LENGTH)
  name: string;

  @IsString()
  @MaxLength(MAX_PATH_LENGTH)
  path: string;

  @IsNumber()
  @Min(1)
  page_number: number;

  @IsNumber()
  timestamp: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsObject()
  properties?: Record<string, string>;
}

// === Current Page DTO ===

export class CurrentPageDto {
  @IsString()
  @MaxLength(MAX_PATH_LENGTH)
  path: string;

  @IsNumber()
  @Min(1)
  page_number: number;

  @IsNumber()
  entered_at: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  scroll: number;
}

// === Session Attributes DTO ===

export class SessionAttributesDto {
  @IsOptional()
  @IsString()
  referrer?: string;

  @IsString()
  landing_page: string;

  @IsOptional()
  @IsString()
  utm_source?: string;

  @IsOptional()
  @IsString()
  utm_medium?: string;

  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @IsOptional()
  @IsString()
  utm_term?: string;

  @IsOptional()
  @IsString()
  utm_content?: string;

  @IsOptional()
  @IsString()
  utm_id?: string;

  @IsOptional()
  @IsString()
  utm_id_from?: string;

  @IsOptional()
  @IsNumber()
  screen_width?: number;

  @IsOptional()
  @IsNumber()
  screen_height?: number;

  @IsOptional()
  @IsNumber()
  viewport_width?: number;

  @IsOptional()
  @IsNumber()
  viewport_height?: number;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  browser?: string;

  @IsOptional()
  @IsString()
  browser_type?: string;

  @IsOptional()
  @IsString()
  os?: string;

  @IsOptional()
  @IsString()
  user_agent?: string;

  @IsOptional()
  @IsString()
  connection_type?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

// === Session Payload DTO ===

export class SessionPayloadDto {
  @IsString()
  @IsNotEmpty()
  workspace_id: string;

  @IsString()
  @IsNotEmpty()
  session_id: string;

  @IsArray()
  @ArrayMaxSize(MAX_ACTIONS)
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: PageviewActionDto, name: 'pageview' },
        { value: GoalActionDto, name: 'goal' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  actions: (PageviewActionDto | GoalActionDto)[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CurrentPageDto)
  current_page?: CurrentPageDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  checkpoint?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionAttributesDto)
  attributes?: SessionAttributesDto;

  @IsNumber()
  @IsWithinTimeBounds(TIMESTAMP_BOUNDS_HOURS, 'both')
  created_at: number;

  @IsNumber()
  @IsWithinTimeBounds(TIMESTAMP_BOUNDS_HOURS, 'both')
  updated_at: number;

  @IsOptional()
  @IsString()
  sdk_version?: string;
}

// === Type Guards ===

export type Action = PageviewActionDto | GoalActionDto;

export function isPageviewAction(action: Action): action is PageviewActionDto {
  return action.type === 'pageview';
}

export function isGoalAction(action: Action): action is GoalActionDto {
  return action.type === 'goal';
}
```

### File: `api/src/common/validators/compare.validator.ts`

```typescript
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsGreaterThanOrEqual(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGreaterThanOrEqual',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as any)[relatedPropertyName];

          if (typeof value !== 'number' || typeof relatedValue !== 'number') {
            return false;
          }

          return value >= relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          return `${args.property} must be greater than or equal to ${relatedPropertyName}`;
        },
      },
    });
  };
}
```

### File: `api/src/common/validators/time-bounds.validator.ts`

```typescript
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsWithinTimeBounds(
  hours: number,
  direction: 'past' | 'future' | 'both',
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWithinTimeBounds',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [hours, direction],
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'number') return false;

          const [hours, direction] = args.constraints;
          const now = Date.now();
          const boundMs = hours * 60 * 60 * 1000;

          if (direction === 'past' || direction === 'both') {
            if (value < now - boundMs) return false;
          }
          if (direction === 'future' || direction === 'both') {
            if (value > now + boundMs) return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const [hours, direction] = args.constraints;
          if (direction === 'past') {
            return `${args.property} must not be more than ${hours} hours in the past`;
          }
          if (direction === 'future') {
            return `${args.property} must not be more than ${hours} hours in the future`;
          }
          return `${args.property} must be within ${hours} hours of current time`;
        },
      },
    });
  };
}
```

## Usage Example

```typescript
// In controller
@Post('api/track.session')
async trackSession(
  @Body() payload: SessionPayloadDto,
  @Ip() ip: string,
): Promise<{ success: boolean; checkpoint?: number }> {
  return this.eventsService.trackSession(payload, ip);
}

// In service
async trackSession(payload: SessionPayloadDto, ip: string | null) {
  for (const action of payload.actions) {
    if (isPageviewAction(action)) {
      // Handle pageview
      await this.processPageview(payload, action);
    } else if (isGoalAction(action)) {
      // Handle goal
      await this.processGoal(payload, action);
    }
  }

  return { success: true, checkpoint: payload.actions.length };
}
```

## Checklist

- [ ] Create `api/src/events/dto/session-payload.dto.ts`
- [ ] Create `api/src/common/validators/time-bounds.validator.ts`
- [ ] Create `api/src/common/validators/compare.validator.ts`
- [ ] Create `api/src/events/dto/session-payload.dto.spec.ts` with tests
- [ ] Run tests: `npm test -- session-payload.dto`
- [ ] Verify discriminated union works with class-transformer
- [ ] Verify nested validation errors are properly reported
- [ ] Verify timestamp bounds validation works (both past and future)
- [ ] Verify empty string rejection for workspace_id/session_id
- [ ] Verify exited_at >= entered_at validation works
