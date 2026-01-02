import {
  computeFilterVersion,
  evaluateCondition,
  evaluateConditions,
  evaluateFilters,
  extractFieldValues,
  applyFilterResults,
  FilterResult,
} from './filter-evaluator';
import { FilterDefinition, FilterCondition } from '../entities/filter.entity';

describe('filter-evaluator', () => {
  describe('computeFilterVersion', () => {
    const createFilter = (
      id: string,
      overrides: Partial<FilterDefinition> = {},
    ): FilterDefinition => ({
      id,
      name: 'Test Filter',
      priority: 100,
      order: 0,
      tags: [],
      conditions: [],
      operations: [],
      enabled: true,
      version: '',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ...overrides,
    });

    it('returns consistent hash for same filters', () => {
      const filters = [createFilter('f1'), createFilter('f2')];
      const hash1 = computeFilterVersion(filters);
      const hash2 = computeFilterVersion(filters);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash when filter conditions change', () => {
      const filters1 = [
        createFilter('f1', {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
        }),
      ];
      const filters2 = [
        createFilter('f1', {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'facebook' }],
        }),
      ];
      expect(computeFilterVersion(filters1)).not.toBe(computeFilterVersion(filters2));
    });

    it('returns different hash when filter enabled status changes', () => {
      const filters1 = [createFilter('f1', { enabled: true })];
      const filters2 = [createFilter('f1', { enabled: false })];
      expect(computeFilterVersion(filters1)).not.toBe(computeFilterVersion(filters2));
    });

    it('is order-independent (sorts by id)', () => {
      const f1 = createFilter('a');
      const f2 = createFilter('b');
      const hash1 = computeFilterVersion([f1, f2]);
      const hash2 = computeFilterVersion([f2, f1]);
      expect(hash1).toBe(hash2);
    });

    it('returns 8-character hex string', () => {
      const hash = computeFilterVersion([createFilter('f1')]);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('evaluateCondition', () => {
    it('returns false for null field value', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'equals',
        value: 'google',
      };
      expect(evaluateCondition(condition, { utm_source: null })).toBe(false);
    });

    it('returns false for undefined field value', () => {
      const condition: FilterCondition = {
        field: 'utm_source',
        operator: 'equals',
        value: 'google',
      };
      expect(evaluateCondition(condition, {})).toBe(false);
    });

    describe('equals operator', () => {
      it('matches exact value', () => {
        const condition: FilterCondition = {
          field: 'utm_source',
          operator: 'equals',
          value: 'google',
        };
        expect(evaluateCondition(condition, { utm_source: 'google' })).toBe(true);
        expect(evaluateCondition(condition, { utm_source: 'Google' })).toBe(false);
        expect(evaluateCondition(condition, { utm_source: 'facebook' })).toBe(false);
      });
    });

    describe('contains operator', () => {
      it('matches substring', () => {
        const condition: FilterCondition = {
          field: 'referrer',
          operator: 'contains',
          value: 'google',
        };
        expect(
          evaluateCondition(condition, { referrer: 'https://www.google.com/search' }),
        ).toBe(true);
        expect(
          evaluateCondition(condition, { referrer: 'https://facebook.com' }),
        ).toBe(false);
      });
    });

    describe('regex operator', () => {
      it('matches regex pattern', () => {
        const condition: FilterCondition = {
          field: 'utm_campaign',
          operator: 'regex',
          value: '^summer_\\d{4}$',
        };
        expect(evaluateCondition(condition, { utm_campaign: 'summer_2025' })).toBe(true);
        expect(evaluateCondition(condition, { utm_campaign: 'winter_2025' })).toBe(false);
        expect(evaluateCondition(condition, { utm_campaign: 'summer_sale' })).toBe(false);
      });

      it('returns false for invalid regex', () => {
        const condition: FilterCondition = {
          field: 'utm_source',
          operator: 'regex',
          value: '[invalid regex',
        };
        expect(evaluateCondition(condition, { utm_source: 'anything' })).toBe(false);
      });
    });

    it('returns false for unknown operator', () => {
      const condition = {
        field: 'utm_source',
        operator: 'unknown' as never,
        value: 'google',
      };
      expect(evaluateCondition(condition, { utm_source: 'google' })).toBe(false);
    });
  });

  describe('evaluateConditions', () => {
    it('returns true for empty conditions (always matches)', () => {
      expect(evaluateConditions([], {})).toBe(true);
    });

    it('requires all conditions to match (AND logic)', () => {
      const conditions: FilterCondition[] = [
        { field: 'utm_source', operator: 'equals', value: 'google' },
        { field: 'utm_medium', operator: 'equals', value: 'cpc' },
      ];
      expect(
        evaluateConditions(conditions, { utm_source: 'google', utm_medium: 'cpc' }),
      ).toBe(true);
      expect(
        evaluateConditions(conditions, { utm_source: 'google', utm_medium: 'organic' }),
      ).toBe(false);
      expect(
        evaluateConditions(conditions, { utm_source: 'facebook', utm_medium: 'cpc' }),
      ).toBe(false);
    });
  });

  describe('evaluateFilters', () => {
    const createFilter = (
      id: string,
      priority: number,
      overrides: Partial<FilterDefinition> = {},
    ): FilterDefinition => ({
      id,
      name: 'Test Filter',
      priority,
      order: 0,
      tags: [],
      conditions: [],
      operations: [],
      enabled: true,
      version: '',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ...overrides,
    });

    it('returns empty result when no filters match', () => {
      const filters = [
        createFilter('f1', 100, {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
          operations: [{ dimension: 'channel', action: 'set_value', value: 'Paid' }],
        }),
      ];
      const result = evaluateFilters(filters, { utm_source: 'facebook' });
      expect(result).toEqual({});
    });

    it('executes operations when conditions match', () => {
      const filters = [
        createFilter('f1', 100, {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
          operations: [{ dimension: 'channel', action: 'set_value', value: 'Paid Search' }],
        }),
      ];
      const result = evaluateFilters(filters, { utm_source: 'google' });
      expect(result.channel).toBe('Paid Search');
    });

    it('ignores disabled filters', () => {
      const filters = [
        createFilter('f1', 100, {
          enabled: false,
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
          operations: [{ dimension: 'channel', action: 'set_value', value: 'Paid' }],
        }),
      ];
      const result = evaluateFilters(filters, { utm_source: 'google' });
      expect(result).toEqual({});
    });

    it('higher priority wins for set_value', () => {
      const filters = [
        createFilter('low', 50, {
          conditions: [],
          operations: [{ dimension: 'channel', action: 'set_value', value: 'Low Priority' }],
        }),
        createFilter('high', 100, {
          conditions: [],
          operations: [{ dimension: 'channel', action: 'set_value', value: 'High Priority' }],
        }),
      ];
      const result = evaluateFilters(filters, {});
      expect(result.channel).toBe('High Priority');
    });

    it('unset_value sets dimension to null', () => {
      const filters = [
        createFilter('f1', 100, {
          conditions: [],
          operations: [{ dimension: 'utm_source', action: 'unset_value' }],
        }),
      ];
      const result = evaluateFilters(filters, { utm_source: 'google' });
      expect(result.utm_source).toBeNull();
    });

    it('set_default_value only sets if not already set', () => {
      const filters = [
        createFilter('default', 50, {
          conditions: [],
          operations: [{ dimension: 'channel', action: 'set_default_value', value: 'Default' }],
        }),
        createFilter('specific', 100, {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
          operations: [{ dimension: 'channel', action: 'set_value', value: 'Google' }],
        }),
      ];

      // When specific filter matches, it wins
      const result1 = evaluateFilters(filters, { utm_source: 'google' });
      expect(result1.channel).toBe('Google');

      // When specific filter doesn't match, default applies
      const result2 = evaluateFilters(filters, { utm_source: 'facebook' });
      expect(result2.channel).toBe('Default');
    });

    it('set_default_value fills in null from unset_value', () => {
      const filters = [
        createFilter('unset', 100, {
          conditions: [{ field: 'is_direct', operator: 'equals', value: 'true' }],
          operations: [{ dimension: 'channel', action: 'unset_value' }],
        }),
        createFilter('default', 50, {
          conditions: [],
          operations: [{ dimension: 'channel', action: 'set_default_value', value: 'Direct' }],
        }),
      ];
      const result = evaluateFilters(filters, { is_direct: 'true' });
      // unset_value sets to null, then set_default_value fills it
      expect(result.channel).toBe('Direct');
    });
  });

  describe('extractFieldValues', () => {
    it('extracts UTM fields', () => {
      const event = {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'summer_sale',
      };
      const fields = extractFieldValues(event);
      expect(fields.utm_source).toBe('google');
      expect(fields.utm_medium).toBe('cpc');
      expect(fields.utm_campaign).toBe('summer_sale');
    });

    it('extracts traffic fields', () => {
      const event = {
        referrer: 'https://google.com/search',
        referrer_domain: 'google.com',
        is_direct: false,
      };
      const fields = extractFieldValues(event);
      expect(fields.referrer).toBe('https://google.com/search');
      expect(fields.referrer_domain).toBe('google.com');
      expect(fields.is_direct).toBe('false');
    });

    it('converts is_direct boolean to string', () => {
      expect(extractFieldValues({ is_direct: true }).is_direct).toBe('true');
      expect(extractFieldValues({ is_direct: false }).is_direct).toBe('false');
    });

    it('extracts page fields', () => {
      const event = {
        landing_page: '/home',
        landing_domain: 'example.com',
        path: '/about',
      };
      const fields = extractFieldValues(event);
      expect(fields.landing_page).toBe('/home');
      expect(fields.landing_domain).toBe('example.com');
      expect(fields.path).toBe('/about');
    });

    it('extracts device fields', () => {
      const event = {
        device: 'mobile',
        browser: 'Chrome',
        os: 'iOS',
      };
      const fields = extractFieldValues(event);
      expect(fields.device).toBe('mobile');
      expect(fields.browser).toBe('Chrome');
      expect(fields.os).toBe('iOS');
    });
  });

  describe('applyFilterResults', () => {
    const createFilter = (
      id: string,
      conditions: FilterCondition[],
      operations: FilterDefinition['operations'],
    ): FilterDefinition => ({
      id,
      name: 'Test',
      priority: 100,
      order: 0,
      tags: [],
      conditions,
      operations,
      enabled: true,
      version: '',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    });

    it('returns initialized custom dimensions structure', () => {
      const { customDimensions } = applyFilterResults([], {}, {});

      expect(customDimensions).toEqual({
        channel: null,
        channel_group: null,
        cd_1: null,
        cd_2: null,
        cd_3: null,
        cd_4: null,
        cd_5: null,
        cd_6: null,
        cd_7: null,
        cd_8: null,
        cd_9: null,
        cd_10: null,
      });
    });

    it('sets channel dimension', () => {
      const filters = [
        createFilter(
          'f1',
          [],
          [{ dimension: 'channel', action: 'set_value', value: 'Paid Search' }],
        ),
      ];
      const { customDimensions } = applyFilterResults(filters, {}, {});
      expect(customDimensions.channel).toBe('Paid Search');
    });

    it('sets custom dimension slots', () => {
      const filters = [
        createFilter('f1', [], [
          { dimension: 'cd_1', action: 'set_value', value: 'Value 1' },
          { dimension: 'cd_5', action: 'set_value', value: 'Value 5' },
        ]),
      ];
      const { customDimensions } = applyFilterResults(filters, {}, {});
      expect(customDimensions.cd_1).toBe('Value 1');
      expect(customDimensions.cd_5).toBe('Value 5');
    });

    it('tracks modified standard fields', () => {
      const filters = [
        createFilter('f1', [], [
          { dimension: 'utm_source', action: 'set_value', value: 'modified_source' },
        ]),
      ];
      const { modifiedFields } = applyFilterResults(filters, {}, {});
      expect(modifiedFields.utm_source).toBe('modified_source');
    });

    it('handles channel_group dimension', () => {
      const filters = [
        createFilter('f1', [], [
          { dimension: 'channel_group', action: 'set_value', value: 'Marketing' },
        ]),
      ];
      const { customDimensions } = applyFilterResults(filters, {}, {});
      expect(customDimensions.channel_group).toBe('Marketing');
    });
  });
});
