import { buildFilters, buildMetricFilters } from './filter-builder';
import { FilterDto, MetricFilterDto } from '../dto/analytics-query.dto';
import { MetricContext } from '../constants/metrics';

describe('buildFilters', () => {
  it('returns empty for no filters', () => {
    const result = buildFilters([]);
    expect(result.sql).toBe('');
    expect(result.params).toEqual({});
  });

  it('returns empty for undefined filters', () => {
    const result = buildFilters(undefined as unknown as FilterDto[]);
    expect(result.sql).toBe('');
    expect(result.params).toEqual({});
  });

  it('handles equals operator', () => {
    const result = buildFilters([
      { dimension: 'device', operator: 'equals', values: ['mobile'] },
    ]);
    expect(result.sql).toBe('device = {f0:String}');
    expect(result.params.f0).toBe('mobile');
  });

  it('handles notEquals operator', () => {
    const result = buildFilters([
      { dimension: 'device', operator: 'notEquals', values: ['mobile'] },
    ]);
    expect(result.sql).toBe('device != {f0:String}');
    expect(result.params.f0).toBe('mobile');
  });

  it('handles in operator with array', () => {
    const result = buildFilters([
      {
        dimension: 'utm_source',
        operator: 'in',
        values: ['google', 'facebook'],
      },
    ]);
    expect(result.sql).toBe('utm_source IN {f0:Array(String)}');
    expect(result.params.f0).toEqual(['google', 'facebook']);
  });

  it('handles notIn operator', () => {
    const result = buildFilters([
      { dimension: 'utm_source', operator: 'notIn', values: ['google'] },
    ]);
    expect(result.sql).toBe('utm_source NOT IN {f0:Array(String)}');
    expect(result.params.f0).toEqual(['google']);
  });

  it('handles contains with LIKE', () => {
    const result = buildFilters([
      { dimension: 'utm_campaign', operator: 'contains', values: ['summer'] },
    ]);
    expect(result.sql).toBe('utm_campaign LIKE {f0:String}');
    expect(result.params.f0).toBe('%summer%');
  });

  it('handles notContains with NOT LIKE', () => {
    const result = buildFilters([
      {
        dimension: 'utm_campaign',
        operator: 'notContains',
        values: ['summer'],
      },
    ]);
    expect(result.sql).toBe('utm_campaign NOT LIKE {f0:String}');
    expect(result.params.f0).toBe('%summer%');
  });

  it('handles gt operator', () => {
    const result = buildFilters([
      { dimension: 'hour', operator: 'gt', values: [10] },
    ]);
    expect(result.sql).toBe('hour > {f0:Float64}');
    expect(result.params.f0).toBe(10);
  });

  it('handles gte operator', () => {
    const result = buildFilters([
      { dimension: 'hour', operator: 'gte', values: [10] },
    ]);
    expect(result.sql).toBe('hour >= {f0:Float64}');
    expect(result.params.f0).toBe(10);
  });

  it('handles lt operator', () => {
    const result = buildFilters([
      { dimension: 'hour', operator: 'lt', values: [18] },
    ]);
    expect(result.sql).toBe('hour < {f0:Float64}');
    expect(result.params.f0).toBe(18);
  });

  it('handles lte operator', () => {
    const result = buildFilters([
      { dimension: 'hour', operator: 'lte', values: [18] },
    ]);
    expect(result.sql).toBe('hour <= {f0:Float64}');
    expect(result.params.f0).toBe(18);
  });

  it('handles isNull without values', () => {
    const result = buildFilters([
      { dimension: 'utm_source', operator: 'isNull' },
    ]);
    expect(result.sql).toBe('utm_source IS NULL');
    expect(Object.keys(result.params)).toHaveLength(0);
  });

  it('handles isNotNull without values', () => {
    const result = buildFilters([
      { dimension: 'utm_source', operator: 'isNotNull' },
    ]);
    expect(result.sql).toBe('utm_source IS NOT NULL');
    expect(Object.keys(result.params)).toHaveLength(0);
  });

  it('handles isEmpty operator', () => {
    const result = buildFilters([
      { dimension: 'utm_source', operator: 'isEmpty' },
    ]);
    expect(result.sql).toBe("(utm_source = '' OR utm_source IS NULL)");
    expect(Object.keys(result.params)).toHaveLength(0);
  });

  it('handles isNotEmpty operator', () => {
    const result = buildFilters([
      { dimension: 'utm_source', operator: 'isNotEmpty' },
    ]);
    expect(result.sql).toBe("(utm_source != '' AND utm_source IS NOT NULL)");
    expect(Object.keys(result.params)).toHaveLength(0);
  });

  it('handles between with two values', () => {
    const result = buildFilters([
      { dimension: 'hour', operator: 'between', values: [9, 17] },
    ]);
    expect(result.sql).toBe('hour BETWEEN {f0a:Float64} AND {f0b:Float64}');
    expect(result.params.f0a).toBe(9);
    expect(result.params.f0b).toBe(17);
  });

  it('combines multiple filters with AND', () => {
    const result = buildFilters([
      { dimension: 'device', operator: 'equals', values: ['mobile'] },
      { dimension: 'utm_source', operator: 'equals', values: ['google'] },
    ]);
    expect(result.sql).toBe(
      'device = {f0:String} AND utm_source = {f1:String}',
    );
    expect(result.params.f0).toBe('mobile');
    expect(result.params.f1).toBe('google');
  });

  it('uses custom param prefix', () => {
    const result = buildFilters(
      [{ dimension: 'device', operator: 'equals', values: ['mobile'] }],
      'filter',
    );
    expect(result.sql).toBe('device = {filter0:String}');
    expect(result.params.filter0).toBe('mobile');
  });

  it('throws for unknown dimension', () => {
    expect(() =>
      buildFilters([
        { dimension: 'unknown_dim', operator: 'equals', values: ['x'] },
      ]),
    ).toThrow('Unknown dimension: unknown_dim');
  });

  describe('table parameter', () => {
    it('defaults to sessions table', () => {
      const result = buildFilters([
        { dimension: 'device', operator: 'equals', values: ['mobile'] },
      ]);
      expect(result.sql).toBe('device = {f0:String}');
    });

    it('accepts sessions table explicitly', () => {
      const result = buildFilters(
        [{ dimension: 'utm_source', operator: 'equals', values: ['google'] }],
        'f',
        'sessions',
      );
      expect(result.sql).toBe('utm_source = {f0:String}');
    });

    it('accepts pages table for page dimensions', () => {
      const result = buildFilters(
        [{ dimension: 'page_path', operator: 'equals', values: ['/products'] }],
        'f',
        'pages',
      );
      expect(result.sql).toBe('path = {f0:String}');
      expect(result.params.f0).toBe('/products');
    });

    it('throws for sessions dimension on pages table', () => {
      expect(() =>
        buildFilters(
          [{ dimension: 'utm_source', operator: 'equals', values: ['google'] }],
          'f',
          'pages',
        ),
      ).toThrow("Dimension 'utm_source' is not available for table 'pages'");
    });

    it('throws for pages dimension on sessions table', () => {
      expect(() =>
        buildFilters(
          [{ dimension: 'page_path', operator: 'equals', values: ['/'] }],
          'f',
          'sessions',
        ),
      ).toThrow("Dimension 'page_path' is not available for table 'sessions'");
    });

    it('validates multiple filters against table', () => {
      expect(() =>
        buildFilters(
          [
            { dimension: 'page_path', operator: 'equals', values: ['/'] },
            { dimension: 'utm_source', operator: 'equals', values: ['google'] },
          ],
          'f',
          'pages',
        ),
      ).toThrow("Dimension 'utm_source' is not available for table 'pages'");
    });

    it('handles page_path in filter correctly', () => {
      const result = buildFilters(
        [
          {
            dimension: 'page_path',
            operator: 'in',
            values: ['/', '/products'],
          },
        ],
        'f',
        'pages',
      );
      expect(result.sql).toBe('path IN {f0:Array(String)}');
      expect(result.params.f0).toEqual(['/', '/products']);
    });

    it('handles is_landing_page boolean filter', () => {
      const result = buildFilters(
        [
          {
            dimension: 'is_landing_page',
            operator: 'equals',
            values: ['true'],
          },
        ],
        'f',
        'pages',
      );
      expect(result.sql).toBe('is_landing = {f0:String}');
    });
  });
});

describe('buildMetricFilters', () => {
  const defaultContext: MetricContext = { bounce_threshold: 10 };

  it('returns empty for no filters', () => {
    const result = buildMetricFilters([], 'sessions', defaultContext);
    expect(result.sql).toBe('');
    expect(result.params).toEqual({});
  });

  it('returns empty for undefined filters', () => {
    const result = buildMetricFilters(
      undefined as unknown as MetricFilterDto[],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toBe('');
    expect(result.params).toEqual({});
  });

  it('handles gt operator', () => {
    const result = buildMetricFilters(
      [{ metric: 'bounce_rate', operator: 'gt', values: [50] }],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toContain('> {mf0:Float64}');
    expect(result.params.mf0).toBe(50);
  });

  it('handles gte operator', () => {
    const result = buildMetricFilters(
      [{ metric: 'median_duration', operator: 'gte', values: [30] }],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toContain('>= {mf0:Float64}');
    expect(result.params.mf0).toBe(30);
  });

  it('handles lt operator', () => {
    const result = buildMetricFilters(
      [{ metric: 'bounce_rate', operator: 'lt', values: [25] }],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toContain('< {mf0:Float64}');
    expect(result.params.mf0).toBe(25);
  });

  it('handles lte operator', () => {
    const result = buildMetricFilters(
      [{ metric: 'median_scroll', operator: 'lte', values: [75] }],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toContain('<= {mf0:Float64}');
    expect(result.params.mf0).toBe(75);
  });

  it('handles between operator', () => {
    const result = buildMetricFilters(
      [{ metric: 'bounce_rate', operator: 'between', values: [20, 80] }],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toContain('BETWEEN {mf0a:Float64} AND {mf0b:Float64}');
    expect(result.params.mf0a).toBe(20);
    expect(result.params.mf0b).toBe(80);
  });

  it('combines multiple metric filters with AND', () => {
    const result = buildMetricFilters(
      [
        { metric: 'bounce_rate', operator: 'gt', values: [50] },
        { metric: 'median_duration', operator: 'gte', values: [10] },
      ],
      'sessions',
      defaultContext,
    );
    expect(result.sql).toContain(' AND ');
    expect(result.params.mf0).toBe(50);
    expect(result.params.mf1).toBe(10);
  });

  it('uses custom param prefix', () => {
    const result = buildMetricFilters(
      [{ metric: 'bounce_rate', operator: 'gt', values: [50] }],
      'sessions',
      defaultContext,
      'metric',
    );
    expect(result.sql).toContain('{metric0:Float64}');
    expect(result.params.metric0).toBe(50);
  });

  it('throws for unknown metric', () => {
    expect(() =>
      buildMetricFilters(
        [{ metric: 'unknown_metric', operator: 'gt', values: [50] }],
        'sessions',
        defaultContext,
      ),
    ).toThrow('Unknown metric: unknown_metric');
  });

  it('throws for metric not available on table', () => {
    expect(() =>
      buildMetricFilters(
        [{ metric: 'sessions', operator: 'gt', values: [100] }],
        'pages',
        defaultContext,
      ),
    ).toThrow("Metric 'sessions' is not available for table 'pages'");
  });

  it('uses bounce_threshold from context for bounce_rate', () => {
    const customContext: MetricContext = { bounce_threshold: 20 };
    const result = buildMetricFilters(
      [{ metric: 'bounce_rate', operator: 'gt', values: [50] }],
      'sessions',
      customContext,
    );
    // bounce_rate SQL uses: countIf(duration < {bounce_threshold * 1000})
    expect(result.sql).toContain('20000');
  });
});
