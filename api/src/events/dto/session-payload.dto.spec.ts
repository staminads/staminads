import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  PageviewActionDto,
  GoalActionDto,
  SessionPayloadDto,
  Action,
  isPageviewAction,
  isGoalAction,
} from './session-payload.dto';

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
    const errorFields = errors.map((e) => e.property);
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

    expect(errors.some((e) => e.property === 'scroll')).toBe(true);
  });

  it('rejects negative duration', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      duration: -100,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'duration')).toBe(true);
  });

  it('rejects page_number less than 1', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      page_number: 0,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'page_number')).toBe(true);
  });

  it('rejects path longer than 2048 characters', async () => {
    const dto = plainToInstance(PageviewActionDto, {
      ...validPageview,
      path: '/' + 'a'.repeat(2048), // 2049 chars total
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'path')).toBe(true);
  });
});

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

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects goal_name longer than 100 characters', async () => {
    const dto = plainToInstance(GoalActionDto, {
      ...validGoal,
      name: 'a'.repeat(101),
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects negative goal value', async () => {
    const dto = plainToInstance(GoalActionDto, {
      ...validGoal,
      value: -10,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'value')).toBe(true);
  });
});

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

    expect(errors.some((e) => e.property === 'workspace_id')).toBe(true);
  });

  it('rejects payload without session_id', async () => {
    const { session_id, ...payloadWithoutSession } = validPayload;
    const dto = plainToInstance(SessionPayloadDto, payloadWithoutSession);
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'session_id')).toBe(true);
  });

  it('rejects payload with more than MAX_ACTIONS', async () => {
    const tooManyActions = Array(1001)
      .fill(null)
      .map((_, i) => ({
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

    expect(errors.some((e) => e.property === 'actions')).toBe(true);
  });
});

describe('SessionPayloadDto - Nested Action Validation', () => {
  it('validates nested pageview actions', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [
        {
          type: 'pageview',
          path: '/home',
          page_number: 0, // Invalid: must be >= 1
          duration: -100, // Invalid: must be >= 0
          scroll: 150, // Invalid: must be <= 100
          entered_at: Date.now(),
          exited_at: Date.now(),
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    // Should have nested validation errors
    expect(errors.some((e) => e.property === 'actions')).toBe(true);
    const actionsError = errors.find((e) => e.property === 'actions');
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

    expect(errors.some((e) => e.property === 'actions')).toBe(true);
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

describe('SessionPayloadDto - Timestamp Bounds', () => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  it('rejects created_at more than 24 hours in the past', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now - TWENTY_FOUR_HOURS_MS - 1000, // 24h + 1s ago
      updated_at: now,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'created_at')).toBe(true);
  });

  it('rejects created_at more than 24 hours in the future', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now + TWENTY_FOUR_HOURS_MS + 1000, // 24h + 1s from now
      updated_at: now + TWENTY_FOUR_HOURS_MS + 1000,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'created_at')).toBe(true);
  });

  it('rejects updated_at more than 24 hours in the past', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now - TWENTY_FOUR_HOURS_MS - 1000,
      updated_at: now - TWENTY_FOUR_HOURS_MS - 1000, // 24h + 1s ago
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'updated_at')).toBe(true);
  });

  it('rejects updated_at more than 24 hours in the future', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now,
      updated_at: now + TWENTY_FOUR_HOURS_MS + 1000, // 24h + 1s from now
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'updated_at')).toBe(true);
  });

  it('accepts timestamps within valid range', async () => {
    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws-test',
      session_id: 'sess-123',
      actions: [],
      created_at: now - 3600000, // 1 hour ago
      updated_at: now,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

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
    expect(errors.some((e) => e.property === 'attributes')).toBe(true);
  });
});

describe('Action Type Discrimination', () => {
  it('correctly identifies pageview action type', () => {
    const action: Action = {
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
    const action: Action = {
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

    expect(errors.some((e) => e.property === 'workspace_id')).toBe(true);
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

    expect(errors.some((e) => e.property === 'session_id')).toBe(true);
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

    expect(errors.some((e) => e.property === 'actions')).toBe(true);
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

    expect(errors.some((e) => e.property === 'actions')).toBe(true);
  });
});

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
      exited_at: now - 1000, // Before entered_at
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'exited_at')).toBe(true);
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

// === Cross-Phase Tests ===
describe('Cross-phase validation - payload size', () => {
  const MAX_ACTIONS = 1000;

  it('rejects payload with actions exceeding MAX_ACTIONS', async () => {
    const now = Date.now();
    const actions = Array(MAX_ACTIONS + 1)
      .fill(null)
      .map((_, i) => ({
        type: 'pageview',
        path: `/page-${i}`,
        page_number: i + 1,
        duration: 1000,
        scroll: 50,
        entered_at: now - 1000,
        exited_at: now,
      }));

    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws',
      session_id: 'sess',
      actions,
      created_at: now - 10000,
      updated_at: now,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'actions')).toBe(true);
  });

  it('accepts payload with exactly MAX_ACTIONS', async () => {
    const now = Date.now();
    const actions = Array(MAX_ACTIONS)
      .fill(null)
      .map((_, i) => ({
        type: 'pageview',
        path: `/page-${i}`,
        page_number: i + 1,
        duration: 1000,
        scroll: 50,
        entered_at: now - 1000,
        exited_at: now,
      }));

    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws',
      session_id: 'sess',
      actions,
      created_at: now - 10000,
      updated_at: now,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
