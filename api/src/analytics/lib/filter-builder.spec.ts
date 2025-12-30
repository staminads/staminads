import { buildFilters } from './filter-builder';
import { FilterDto } from '../dto/analytics-query.dto';

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
      { dimension: 'utm_source', operator: 'in', values: ['google', 'facebook'] },
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
      { dimension: 'utm_campaign', operator: 'notContains', values: ['summer'] },
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
    expect(result.sql).toBe('device = {f0:String} AND utm_source = {f1:String}');
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
});
