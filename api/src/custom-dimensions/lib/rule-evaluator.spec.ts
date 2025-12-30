import {
  computeVersion,
  evaluateCondition,
  evaluateRule,
  evaluateRules,
  computeCustomDimensions,
  extractFieldValues,
} from './rule-evaluator';
import {
  CustomDimensionCondition,
  CustomDimensionRule,
  CustomDimensionDefinition,
} from '../entities/custom-dimension.entity';

describe('evaluateCondition', () => {
  describe('equals operator', () => {
    const condition: CustomDimensionCondition = {
      field: 'utm_source',
      operator: 'equals',
      value: 'google',
    };

    it('returns true when field value exactly matches condition value', () => {
      const result = evaluateCondition(condition, { utm_source: 'google' });
      expect(result).toBe(true);
    });

    it('returns false when field value does not match', () => {
      const result = evaluateCondition(condition, { utm_source: 'facebook' });
      expect(result).toBe(false);
    });

    it('returns false when field value is null', () => {
      const result = evaluateCondition(condition, { utm_source: null });
      expect(result).toBe(false);
    });

    it('returns false when field value is undefined', () => {
      const result = evaluateCondition(condition, { utm_source: undefined });
      expect(result).toBe(false);
    });

    it('returns false when field is missing', () => {
      const result = evaluateCondition(condition, {});
      expect(result).toBe(false);
    });

    it('is case-sensitive', () => {
      const result = evaluateCondition(condition, { utm_source: 'Google' });
      expect(result).toBe(false);
    });
  });

  describe('contains operator', () => {
    const condition: CustomDimensionCondition = {
      field: 'utm_source',
      operator: 'contains',
      value: 'google',
    };

    it('returns true when field value contains condition value', () => {
      const result = evaluateCondition(condition, { utm_source: 'google.com' });
      expect(result).toBe(true);
    });

    it('returns true when field value equals condition value', () => {
      const result = evaluateCondition(condition, { utm_source: 'google' });
      expect(result).toBe(true);
    });

    it('returns false when field value does not contain condition value', () => {
      const result = evaluateCondition(condition, { utm_source: 'facebook' });
      expect(result).toBe(false);
    });

    it('returns false when field value is null', () => {
      const result = evaluateCondition(condition, { utm_source: null });
      expect(result).toBe(false);
    });

    it('handles empty string condition value', () => {
      const emptyCondition: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'contains',
        value: '',
      };
      const result = evaluateCondition(emptyCondition, { utm_source: 'google' });
      expect(result).toBe(true); // Every string contains empty string
    });

    it('is case-sensitive', () => {
      const result = evaluateCondition(condition, { utm_source: 'GOOGLE.com' });
      expect(result).toBe(false);
    });
  });

  describe('regex operator', () => {
    it('returns true when field value matches regex pattern', () => {
      const condition: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: '^google',
      };
      const result = evaluateCondition(condition, { utm_source: 'google.com' });
      expect(result).toBe(true);
    });

    it('returns false when field value does not match', () => {
      const condition: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: '^google$',
      };
      const result = evaluateCondition(condition, { utm_source: 'google.com' });
      expect(result).toBe(false);
    });

    it('returns false for invalid regex pattern', () => {
      const condition: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: '[invalid',
      };
      const result = evaluateCondition(condition, { utm_source: 'google' });
      expect(result).toBe(false);
    });

    it('returns false when field value is null', () => {
      const condition: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: '.*',
      };
      const result = evaluateCondition(condition, { utm_source: null });
      expect(result).toBe(false);
    });

    it('supports common regex patterns', () => {
      // Test word boundary
      const wordBoundary: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: '\\bgoogle\\b',
      };
      expect(evaluateCondition(wordBoundary, { utm_source: 'google' })).toBe(true);
      expect(evaluateCondition(wordBoundary, { utm_source: 'google.com' })).toBe(true);

      // Test alternation
      const alternation: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: 'google|facebook',
      };
      expect(evaluateCondition(alternation, { utm_source: 'google' })).toBe(true);
      expect(evaluateCondition(alternation, { utm_source: 'facebook' })).toBe(true);
      expect(evaluateCondition(alternation, { utm_source: 'twitter' })).toBe(false);

      // Test case-insensitive flag
      const caseInsensitive: CustomDimensionCondition = {
        field: 'utm_source',
        operator: 'regex',
        value: '(?i)google',
      };
      // Note: (?i) is not supported in JS regex, so this won't match uppercase
      expect(evaluateCondition(caseInsensitive, { utm_source: 'GOOGLE' })).toBe(false);
    });
  });

  describe('unknown operator', () => {
    it('returns false for unknown operator', () => {
      const condition = {
        field: 'utm_source',
        operator: 'unknown' as any,
        value: 'google',
      };
      const result = evaluateCondition(condition, { utm_source: 'google' });
      expect(result).toBe(false);
    });
  });
});

describe('evaluateRule', () => {
  it('returns true when all conditions match (AND logic)', () => {
    const rule: CustomDimensionRule = {
      conditions: [
        { field: 'utm_source', operator: 'contains', value: 'google' },
        { field: 'utm_medium', operator: 'equals', value: 'cpc' },
      ],
      outputValue: 'Google Ads',
    };
    const result = evaluateRule(rule, {
      utm_source: 'google.com',
      utm_medium: 'cpc',
    });
    expect(result).toBe(true);
  });

  it('returns false when any condition fails', () => {
    const rule: CustomDimensionRule = {
      conditions: [
        { field: 'utm_source', operator: 'contains', value: 'google' },
        { field: 'utm_medium', operator: 'equals', value: 'cpc' },
      ],
      outputValue: 'Google Ads',
    };
    const result = evaluateRule(rule, {
      utm_source: 'google.com',
      utm_medium: 'organic',
    });
    expect(result).toBe(false);
  });

  it('returns true for empty conditions array', () => {
    const rule: CustomDimensionRule = {
      conditions: [],
      outputValue: 'Default',
    };
    const result = evaluateRule(rule, { utm_source: 'anything' });
    expect(result).toBe(true);
  });

  it('handles single condition', () => {
    const rule: CustomDimensionRule = {
      conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
      outputValue: 'Google',
    };
    expect(evaluateRule(rule, { utm_source: 'google' })).toBe(true);
    expect(evaluateRule(rule, { utm_source: 'facebook' })).toBe(false);
  });
});

describe('evaluateRules', () => {
  const definition: CustomDimensionDefinition = {
    id: 'cd_test',
    slot: 1,
    name: 'Channel',
    category: 'Custom',
    rules: [
      {
        conditions: [{ field: 'utm_source', operator: 'contains', value: 'google' }],
        outputValue: 'Google',
      },
      {
        conditions: [{ field: 'utm_source', operator: 'contains', value: 'facebook' }],
        outputValue: 'Facebook',
      },
    ],
    defaultValue: 'Other',
    version: 'abc123',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  };

  it('returns first matching rule output value (priority order)', () => {
    const result = evaluateRules(definition, { utm_source: 'google.com' });
    expect(result).toBe('Google');
  });

  it('returns second matching rule when first does not match', () => {
    const result = evaluateRules(definition, { utm_source: 'facebook.com' });
    expect(result).toBe('Facebook');
  });

  it('returns defaultValue when no rules match', () => {
    const result = evaluateRules(definition, { utm_source: 'twitter.com' });
    expect(result).toBe('Other');
  });

  it('returns null when no rules match and no defaultValue', () => {
    const defNoDefault: CustomDimensionDefinition = {
      ...definition,
      defaultValue: undefined,
    };
    const result = evaluateRules(defNoDefault, { utm_source: 'twitter.com' });
    expect(result).toBe(null);
  });

  it('stops at first match (does not evaluate subsequent rules)', () => {
    // If utm_source contains both 'google' and 'facebook', should return 'Google' (first match)
    const defWithOverlap: CustomDimensionDefinition = {
      ...definition,
      rules: [
        {
          conditions: [{ field: 'utm_source', operator: 'contains', value: 'ads' }],
          outputValue: 'Ads',
        },
        {
          conditions: [{ field: 'utm_source', operator: 'contains', value: 'google' }],
          outputValue: 'Google',
        },
      ],
    };
    const result = evaluateRules(defWithOverlap, { utm_source: 'google-ads' });
    expect(result).toBe('Ads'); // First rule matches
  });
});

describe('computeCustomDimensions', () => {
  const createDefinition = (
    slot: number,
    outputValue: string,
    version: string,
  ): CustomDimensionDefinition => ({
    id: `cd_${slot}`,
    slot,
    name: `Dimension ${slot}`,
    category: 'Custom',
    rules: [
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'test' }],
        outputValue,
      },
    ],
    version,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  });

  it('evaluates multiple definitions and assigns to correct slots', () => {
    const definitions = [
      createDefinition(1, 'Value1', 'v1'),
      createDefinition(3, 'Value3', 'v3'),
    ];
    const result = computeCustomDimensions(definitions, { utm_source: 'test' });

    expect(result.cd_1).toBe('Value1');
    expect(result.cd_2).toBe(null);
    expect(result.cd_3).toBe('Value3');
  });

  it('skips invalid slots (< 1)', () => {
    const definitions = [createDefinition(0, 'Value0', 'v0')];
    const result = computeCustomDimensions(definitions, { utm_source: 'test' });

    // All slots should be null since slot 0 is invalid
    expect(result.cd_1).toBe(null);
  });

  it('skips invalid slots (> 10)', () => {
    const definitions = [createDefinition(11, 'Value11', 'v11')];
    const result = computeCustomDimensions(definitions, { utm_source: 'test' });

    expect(result.cd_10).toBe(null);
  });

  it('returns all slots as null when no definitions', () => {
    const result = computeCustomDimensions([], { utm_source: 'test' });

    for (let i = 1; i <= 10; i++) {
      expect(result[`cd_${i}` as keyof typeof result]).toBe(null);
    }
  });

  it('handles definitions where rules do not match', () => {
    const definitions = [createDefinition(1, 'Value1', 'v1')];
    const result = computeCustomDimensions(definitions, { utm_source: 'nomatch' });

    expect(result.cd_1).toBe(null); // No match, no default
  });
});

describe('extractFieldValues', () => {
  it('extracts all UTM fields', () => {
    const event = {
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'summer',
      utm_term: 'shoes',
      utm_content: 'banner',
      utm_id: '123',
      utm_id_from: 'gclid',
    };
    const result = extractFieldValues(event);

    expect(result.utm_source).toBe('google');
    expect(result.utm_medium).toBe('cpc');
    expect(result.utm_campaign).toBe('summer');
    expect(result.utm_term).toBe('shoes');
    expect(result.utm_content).toBe('banner');
    expect(result.utm_id).toBe('123');
    expect(result.utm_id_from).toBe('gclid');
  });

  it('extracts traffic fields (referrer, referrer_domain, etc.)', () => {
    const event = {
      referrer: 'https://google.com/search?q=test',
      referrer_domain: 'google.com',
      referrer_path: '/search',
      is_direct: false,
    };
    const result = extractFieldValues(event);

    expect(result.referrer).toBe('https://google.com/search?q=test');
    expect(result.referrer_domain).toBe('google.com');
    expect(result.referrer_path).toBe('/search');
    expect(result.is_direct).toBe('false');
  });

  it('extracts page fields (landing_page, path, etc.)', () => {
    const event = {
      landing_page: 'https://mysite.com/products',
      landing_domain: 'mysite.com',
      landing_path: '/products',
      path: '/products/shoes',
    };
    const result = extractFieldValues(event);

    expect(result.landing_page).toBe('https://mysite.com/products');
    expect(result.landing_domain).toBe('mysite.com');
    expect(result.landing_path).toBe('/products');
    expect(result.path).toBe('/products/shoes');
  });

  it('extracts device fields (browser, os, device, etc.)', () => {
    const event = {
      device: 'mobile',
      browser: 'Chrome',
      browser_type: 'browser',
      os: 'iOS',
      user_agent: 'Mozilla/5.0...',
      connection_type: '4g',
    };
    const result = extractFieldValues(event);

    expect(result.device).toBe('mobile');
    expect(result.browser).toBe('Chrome');
    expect(result.browser_type).toBe('browser');
    expect(result.os).toBe('iOS');
    expect(result.user_agent).toBe('Mozilla/5.0...');
    expect(result.connection_type).toBe('4g');
  });

  it('extracts geo/locale fields', () => {
    const event = {
      language: 'en-US',
      timezone: 'America/New_York',
    };
    const result = extractFieldValues(event);

    expect(result.language).toBe('en-US');
    expect(result.timezone).toBe('America/New_York');
  });

  it('converts boolean is_direct to string "true"', () => {
    const event = { is_direct: true };
    const result = extractFieldValues(event);
    expect(result.is_direct).toBe('true');
  });

  it('converts boolean is_direct to string "false"', () => {
    const event = { is_direct: false };
    const result = extractFieldValues(event);
    expect(result.is_direct).toBe('false');
  });

  it('handles null and undefined field values', () => {
    const event = {
      utm_source: null,
      utm_medium: undefined,
    };
    const result = extractFieldValues(event);

    expect(result.utm_source).toBe(null);
    expect(result.utm_medium).toBe(undefined);
  });

  it('handles empty event object', () => {
    const result = extractFieldValues({});

    expect(result.utm_source).toBe(undefined);
    expect(result.is_direct).toBe('false'); // Falsy value converts to 'false'
  });
});

describe('computeVersion', () => {
  it('generates consistent hash for same rules', () => {
    const rules: CustomDimensionRule[] = [
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
        outputValue: 'Google',
      },
    ];

    const version1 = computeVersion(rules, 'Other');
    const version2 = computeVersion(rules, 'Other');

    expect(version1).toBe(version2);
  });

  it('generates different hash for different rules', () => {
    const rules1: CustomDimensionRule[] = [
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
        outputValue: 'Google',
      },
    ];
    const rules2: CustomDimensionRule[] = [
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'facebook' }],
        outputValue: 'Facebook',
      },
    ];

    const version1 = computeVersion(rules1, 'Other');
    const version2 = computeVersion(rules2, 'Other');

    expect(version1).not.toBe(version2);
  });

  it('generates different hash when defaultValue changes', () => {
    const rules: CustomDimensionRule[] = [
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
        outputValue: 'Google',
      },
    ];

    const version1 = computeVersion(rules, 'Other');
    const version2 = computeVersion(rules, 'Unknown');

    expect(version1).not.toBe(version2);
  });

  it('generates different hash when defaultValue is undefined vs defined', () => {
    const rules: CustomDimensionRule[] = [
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
        outputValue: 'Google',
      },
    ];

    const version1 = computeVersion(rules, undefined);
    const version2 = computeVersion(rules, 'Other');

    expect(version1).not.toBe(version2);
  });

  it('returns 8 character hash', () => {
    const rules: CustomDimensionRule[] = [];
    const version = computeVersion(rules);

    expect(version).toHaveLength(8);
    expect(version).toMatch(/^[a-f0-9]{8}$/);
  });
});
