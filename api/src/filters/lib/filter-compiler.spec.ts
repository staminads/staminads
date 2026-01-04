import {
  escapeSQL,
  escapeRegex,
  validateSourceField,
  validateDimension,
  compileCondition,
  compileConditions,
  buildCaseExpression,
  compileFiltersToSQL,
} from './filter-compiler';
import {
  FilterCondition,
  FilterDefinition,
  FilterOperation,
} from '../entities/filter.entity';

/**
 * Helper to create a test FilterDefinition with required fields.
 */
function createFilter(
  overrides: Partial<FilterDefinition> & {
    id: string;
    name: string;
    priority: number;
    conditions: FilterCondition[];
    operations: FilterOperation[];
    enabled: boolean;
  },
): FilterDefinition {
  return {
    order: 0,
    tags: [],
    version: 'test',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('escapeSQL', () => {
  it('escapes single quotes', () => {
    expect(escapeSQL("O'Brien")).toBe("O\\'Brien");
  });

  it('escapes backslashes', () => {
    expect(escapeSQL('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes both backslashes and quotes (backslashes first)', () => {
    expect(escapeSQL("it's a\\path")).toBe("it\\'s a\\\\path");
  });

  it('returns unchanged string when no escaping needed', () => {
    expect(escapeSQL('hello world')).toBe('hello world');
  });
});

describe('escapeRegex', () => {
  it('escapes backslashes for SQL embedding', () => {
    expect(escapeRegex('path\\d+')).toBe('path\\\\d+');
  });

  it('escapes single quotes for SQL embedding', () => {
    expect(escapeRegex("test'pattern")).toBe("test\\'pattern");
  });
});

describe('validateSourceField', () => {
  it('accepts valid source fields', () => {
    expect(() => validateSourceField('utm_source')).not.toThrow();
    expect(() => validateSourceField('referrer_domain')).not.toThrow();
    expect(() => validateSourceField('is_direct')).not.toThrow();
    expect(() => validateSourceField('landing_page')).not.toThrow();
  });

  it('throws for invalid source fields', () => {
    expect(() => validateSourceField('invalid_field')).toThrow(
      /Invalid source field: invalid_field/,
    );
    expect(() => validateSourceField('')).toThrow(/Invalid source field:/);
    expect(() => validateSourceField('channel')).toThrow(
      /Invalid source field: channel/,
    );
  });

  it('throws for SQL injection attempts', () => {
    expect(() => validateSourceField("'; DROP TABLE --")).toThrow(
      /Invalid source field/,
    );
    expect(() => validateSourceField('utm_source; DELETE')).toThrow(
      /Invalid source field/,
    );
  });
});

describe('validateDimension', () => {
  it('accepts valid writable dimensions', () => {
    expect(() => validateDimension('channel')).not.toThrow();
    expect(() => validateDimension('channel_group')).not.toThrow();
    expect(() => validateDimension('stm_1')).not.toThrow();
    expect(() => validateDimension('utm_source')).not.toThrow();
    expect(() => validateDimension('is_direct')).not.toThrow();
  });

  it('throws for invalid dimensions', () => {
    expect(() => validateDimension('invalid_dimension')).toThrow(
      /Invalid dimension: invalid_dimension/,
    );
    expect(() => validateDimension('')).toThrow(/Invalid dimension:/);
    expect(() => validateDimension('stm_11')).toThrow(
      /Invalid dimension: stm_11/,
    );
  });

  it('throws for SQL injection attempts', () => {
    expect(() => validateDimension("'; DROP TABLE --")).toThrow(
      /Invalid dimension/,
    );
  });
});

describe('compileCondition', () => {
  describe('equals operator', () => {
    it('compiles string field equals', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'equals',
        value: 'google',
      };
      expect(compileCondition(condition)).toBe(
        "(utm_source != '' AND utm_source = 'google')",
      );
    });

    it('escapes special characters in value', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'equals',
        value: "O'Brien",
      };
      expect(compileCondition(condition)).toBe(
        "(utm_source != '' AND utm_source = 'O\\'Brien')",
      );
    });
  });

  describe('contains operator', () => {
    it('compiles contains using position()', () => {
      const condition: FilterCondition = {
        field: 'referrer_domain',
        operator: 'contains',
        value: 'facebook',
      };
      expect(compileCondition(condition)).toBe(
        "(referrer_domain != '' AND position(referrer_domain, 'facebook') > 0)",
      );
    });
  });

  describe('regex operator', () => {
    it('compiles regex using match()', () => {
      const condition: FilterCondition = {
        field: 'referrer_domain',
        operator: 'regex',
        value: 'facebook|twitter',
      };
      expect(compileCondition(condition)).toBe(
        "(referrer_domain != '' AND match(referrer_domain, 'facebook|twitter'))",
      );
    });

    it('escapes regex pattern for SQL', () => {
      const condition: FilterCondition = {
        field: 'utm_campaign',
        operator: 'regex',
        value: "test\\'s",
      };
      expect(compileCondition(condition)).toBe(
        "(utm_campaign != '' AND match(utm_campaign, 'test\\\\\\'s'))",
      );
    });
  });

  describe('is_direct (boolean field)', () => {
    it('compiles is_direct equals true', () => {
      const condition: FilterCondition = {
        field: 'is_direct',
        operator: 'equals',
        value: 'true',
      };
      expect(compileCondition(condition)).toBe('is_direct = 1');
    });

    it('compiles is_direct equals false', () => {
      const condition: FilterCondition = {
        field: 'is_direct',
        operator: 'equals',
        value: 'false',
      };
      expect(compileCondition(condition)).toBe('is_direct = 0');
    });

    it('compiles is_direct not_equals true', () => {
      const condition: FilterCondition = {
        field: 'is_direct',
        operator: 'not_equals',
        value: 'true',
      };
      expect(compileCondition(condition)).toBe('is_direct != 1');
    });

    it('compiles is_direct is_empty as = 0', () => {
      const condition: FilterCondition = {
        field: 'is_direct',
        operator: 'is_empty',
      };
      expect(compileCondition(condition)).toBe('is_direct = 0');
    });

    it('compiles is_direct is_not_empty as = 1', () => {
      const condition: FilterCondition = {
        field: 'is_direct',
        operator: 'is_not_empty',
      };
      expect(compileCondition(condition)).toBe('is_direct = 1');
    });

    it('returns 0 = 1 for contains/not_contains/regex on boolean', () => {
      const condition: FilterCondition = {
        field: 'is_direct',
        operator: 'contains',
        value: 'true',
      };
      expect(compileCondition(condition)).toBe('0 = 1');
    });
  });

  describe('not_equals operator', () => {
    it('compiles to != with non-empty check', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'not_equals',
        value: 'google',
      };
      expect(compileCondition(condition)).toBe(
        "(utm_source != '' AND utm_source != 'google')",
      );
    });
  });

  describe('not_contains operator', () => {
    it('compiles using position() = 0', () => {
      const condition: FilterCondition = {
        field: 'referrer_domain',
        operator: 'not_contains',
        value: 'facebook',
      };
      expect(compileCondition(condition)).toBe(
        "(referrer_domain != '' AND position(referrer_domain, 'facebook') = 0)",
      );
    });
  });

  describe('is_empty operator', () => {
    it('compiles to empty string OR NULL check', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'is_empty',
      };
      expect(compileCondition(condition)).toBe(
        "(utm_source = '' OR utm_source IS NULL)",
      );
    });
  });

  describe('is_not_empty operator', () => {
    it('compiles to non-empty AND NOT NULL check', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'is_not_empty',
      };
      expect(compileCondition(condition)).toBe(
        "(utm_source != '' AND utm_source IS NOT NULL)",
      );
    });
  });

  describe('unknown operator', () => {
    it('returns 0 = 1 for unknown operator', () => {
      const condition = {
        field: 'utm_source',
        operator: 'startsWith',
        value: 'test',
      } as unknown as FilterCondition;
      expect(compileCondition(condition)).toBe('0 = 1');
    });
  });

  describe('field validation', () => {
    it('throws for invalid field name', () => {
      const condition: FilterCondition = {
        field: 'invalid_field',
        operator: 'equals',
        value: 'test',
      };
      expect(() => compileCondition(condition)).toThrow(/Invalid source field/);
    });
  });
});

describe('compileConditions', () => {
  it('returns 1 = 1 for empty conditions', () => {
    expect(compileConditions([])).toBe('1 = 1');
  });

  it('joins multiple conditions with AND', () => {
    const conditions: FilterCondition[] = [
      { field: 'utm_source', operator: 'contains', value: 'google' },
      { field: 'utm_medium', operator: 'equals', value: 'cpc' },
    ];
    const result = compileConditions(conditions);
    expect(result).toBe(
      "(utm_source != '' AND position(utm_source, 'google') > 0) AND (utm_medium != '' AND utm_medium = 'cpc')",
    );
  });
});

describe('buildCaseExpression', () => {
  it('builds CASE with set_value action', () => {
    const branches = [
      {
        conditionSQL: "utm_source = 'google'",
        action: 'set_value' as const,
        value: 'Paid Search',
      },
    ];
    const result = buildCaseExpression('channel', branches);
    expect(result).toContain("WHEN utm_source = 'google' THEN 'Paid Search'");
    // ELSE '' resets unmatched sessions for custom dimensions
    expect(result).toContain("ELSE ''");
  });

  it('builds CASE with unset_value action', () => {
    const branches = [
      {
        conditionSQL: "utm_source = 'internal'",
        action: 'unset_value' as const,
      },
    ];
    const result = buildCaseExpression('channel', branches);
    // unset_value uses empty string for non-nullable columns
    expect(result).toContain("WHEN utm_source = 'internal' THEN ''");
  });

  it('builds CASE with set_default_value action (no DB value check in backfill)', () => {
    const branches = [
      {
        conditionSQL: '1 = 1',
        action: 'set_default_value' as const,
        value: 'Direct',
      },
    ];
    const result = buildCaseExpression('channel', branches);
    // In backfill, set_default_value just uses the condition - earlier CASE branches take precedence
    expect(result).toContain("WHEN 1 = 1 THEN 'Direct'");
    // Should NOT check existing DB value
    expect(result).not.toContain("AND (channel = '' OR channel IS NULL)");
  });

  it('includes ELSE empty string at the end (resets unmatched sessions)', () => {
    const branches = [
      {
        conditionSQL: 'true',
        action: 'set_value' as const,
        value: 'Test',
      },
    ];
    const result = buildCaseExpression('channel', branches);
    // ELSE '' resets unmatched sessions for custom dimensions
    expect(result).toMatch(/ELSE ''\s*END$/);
  });
});

describe('compileFiltersToSQL', () => {
  it('returns empty setClause when no filters', () => {
    const result = compileFiltersToSQL([]);
    // When no filters, setClause should be empty (no dimensions to update)
    expect(result.setClause).toBe('');
    expect(result.filterVersion).toBeTruthy();
  });

  describe('standard fields (utm_*) are NOT modified by backfill', () => {
    /**
     * This test verifies that standard fields like utm_medium and utm_campaign
     * are NOT affected by backfill unless a filter explicitly targets them.
     *
     * The setClause should ONLY include dimensions that have filter operations.
     * utm_medium may appear in conditions (WHEN clauses) but should never be
     * a target of assignment (no "utm_medium = CASE..." clause).
     */
    it('does not assign utm_medium when no filter targets it', () => {
      const filters: FilterDefinition[] = [
        createFilter({
          id: 'google-ads',
          name: 'Google Ads',
          enabled: true,
          priority: 900,
          conditions: [
            { field: 'utm_source', operator: 'regex', value: '^google$' },
            { field: 'utm_medium', operator: 'regex', value: '^cpc$' },
          ],
          operations: [
            // Operations target channel/channel_group, NOT utm_medium
            {
              dimension: 'channel_group',
              action: 'set_value',
              value: 'search-paid',
            },
            { dimension: 'channel', action: 'set_value', value: 'google-ads' },
          ],
        }),
      ];

      const result = compileFiltersToSQL(filters);

      // Check that utm_medium is NOT a target of assignment (no "utm_medium = CASE...")
      // It may appear in conditions (WHEN clauses) but should never be assigned
      expect(result.setClause).not.toMatch(/utm_medium\s*=\s*CASE/);
      expect(result.setClause).not.toMatch(/utm_campaign\s*=\s*CASE/);

      // Only channel and channel_group should be assignment targets
      expect(result.setClause).toMatch(/channel\s*=\s*CASE/);
      expect(result.setClause).toMatch(/channel_group\s*=\s*CASE/);
    });

    it('does not assign utm_medium even when used in conditions', () => {
      // Filter uses utm_medium in CONDITIONS but doesn't have an OPERATION targeting it
      const filters: FilterDefinition[] = [
        createFilter({
          id: 'test',
          name: 'Test Filter',
          enabled: true,
          priority: 100,
          conditions: [
            { field: 'utm_medium', operator: 'equals', value: 'cpc' },
          ],
          operations: [
            { dimension: 'channel', action: 'set_value', value: 'paid' },
          ],
        }),
      ];

      const result = compileFiltersToSQL(filters);

      // utm_medium used in condition but NOT in operation, so should not be assigned
      expect(result.setClause).not.toMatch(/utm_medium\s*=\s*CASE/);
      expect(result.setClause).toMatch(/channel\s*=\s*CASE/);
    });
  });

  describe('backfill resets unmatched sessions', () => {
    /**
     * When a filter is disabled and backfill runs, sessions that previously matched
     * should be reset (channel becomes '') if no other filter now matches them.
     *
     * Scenario:
     * - google-ads filter (disabled) - was setting channel='google-ads' for utm_medium='cpc'
     * - google-organic filter (enabled) - sets channel='google-organic' for google traffic WITHOUT cpc
     *
     * Session in DB: { utm_source: 'google', utm_medium: 'cpc', channel: 'google-ads' }
     * After backfill: channel should be '' (no filter matches)
     */
    it('uses ELSE empty string to reset unmatched sessions', () => {
      const filters: FilterDefinition[] = [
        createFilter({
          id: 'google-organic',
          name: 'Google Organic',
          enabled: true,
          priority: 50,
          conditions: [
            { field: 'utm_source', operator: 'contains', value: 'google' },
            { field: 'utm_medium', operator: 'not_equals', value: 'cpc' },
          ],
          operations: [
            {
              dimension: 'channel',
              action: 'set_value',
              value: 'google-organic',
            },
          ],
        }),
      ];

      const result = compileFiltersToSQL(filters);

      // ELSE '' resets sessions where no filter matches
      expect(result.setClause).toContain("ELSE ''");
      expect(result.setClause).not.toContain('ELSE channel');
    });

    /**
     * For set_default_value in backfill: earlier CASE branches naturally take precedence.
     * No need to check DB value - if we reach this branch, no higher-priority filter matched.
     */
    it('set_default_value does not check existing DB value in backfill', () => {
      const filters: FilterDefinition[] = [
        createFilter({
          id: 'catch-all',
          name: 'Catch All',
          enabled: true,
          priority: 1,
          conditions: [],
          operations: [
            {
              dimension: 'channel',
              action: 'set_default_value',
              value: 'direct',
            },
          ],
        }),
      ];

      const result = compileFiltersToSQL(filters);

      // In backfill, set_default_value works like set_value
      // (CASE WHEN ordering handles priority, not DB value check)
      expect(result.setClause).not.toContain(
        "AND (channel = '' OR channel IS NULL)",
      );
    });
  });

  it('compiles single filter with set_value', () => {
    const filters: FilterDefinition[] = [
      createFilter({
        id: 'f1',
        name: 'Paid Search',
        enabled: true,
        priority: 100,
        conditions: [
          { field: 'utm_source', operator: 'contains', value: 'google' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Paid Search' },
        ],
      }),
    ];
    const result = compileFiltersToSQL(filters);
    expect(result.setClause).toContain('channel = CASE');
    expect(result.setClause).toContain("THEN 'Paid Search'");
    expect(result.filterVersion).toBeTruthy();
  });

  it('skips disabled filters', () => {
    const filters: FilterDefinition[] = [
      createFilter({
        id: 'f1',
        name: 'Disabled',
        enabled: false,
        priority: 100,
        conditions: [],
        operations: [
          {
            dimension: 'channel',
            action: 'set_value',
            value: 'Should Not Appear',
          },
        ],
      }),
    ];
    const result = compileFiltersToSQL(filters);
    expect(result.setClause).not.toContain('Should Not Appear');
    // Disabled filter means no filters - setClause should be empty
    expect(result.setClause).toBe('');
  });

  it('orders filters by priority (highest first)', () => {
    const filters: FilterDefinition[] = [
      createFilter({
        id: 'low',
        name: 'Low Priority',
        enabled: true,
        priority: 10,
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'low' }],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Low' },
        ],
      }),
      createFilter({
        id: 'high',
        name: 'High Priority',
        enabled: true,
        priority: 100,
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'high' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'High' },
        ],
      }),
    ];
    const result = compileFiltersToSQL(filters);
    // High priority should appear first in CASE statement
    const highIndex = result.setClause.indexOf("'High'");
    const lowIndex = result.setClause.indexOf("'Low'");
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it('handles operations on standard fields', () => {
    const filters: FilterDefinition[] = [
      createFilter({
        id: 'f1',
        name: 'Clear UTM',
        enabled: true,
        priority: 100,
        conditions: [],
        operations: [{ dimension: 'utm_source', action: 'unset_value' }],
      }),
    ];
    const result = compileFiltersToSQL(filters);
    expect(result.setClause).toContain('utm_source = CASE');
  });

  it('handles is_direct boolean field operations', () => {
    const filters: FilterDefinition[] = [
      createFilter({
        id: 'f1',
        name: 'Mark Direct',
        enabled: true,
        priority: 100,
        conditions: [
          { field: 'referrer_domain', operator: 'equals', value: '' },
        ],
        operations: [
          { dimension: 'is_direct', action: 'set_value', value: 'true' },
        ],
      }),
    ];
    const result = compileFiltersToSQL(filters);
    expect(result.setClause).toContain('is_direct = CASE');
    expect(result.setClause).toContain('THEN 1');
  });

  it('generates consistent filterVersion hash', () => {
    const filters: FilterDefinition[] = [
      createFilter({
        id: 'f1',
        name: 'Test',
        enabled: true,
        priority: 100,
        conditions: [],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Test' },
        ],
      }),
    ];
    const result1 = compileFiltersToSQL(filters);
    const result2 = compileFiltersToSQL(filters);
    expect(result1.filterVersion).toBe(result2.filterVersion);
    expect(result1.filterVersion.length).toBeGreaterThan(0);
  });
});
