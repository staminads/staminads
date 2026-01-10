import { getDefaultFilters } from './default-filters';
import {
  VALID_SOURCE_FIELDS,
  VALID_WRITABLE_DIMENSIONS,
} from '../../filters/entities/filter.entity';

describe('getDefaultFilters', () => {
  it('returns an array of filters', () => {
    const filters = getDefaultFilters();

    expect(Array.isArray(filters)).toBe(true);
    expect(filters.length).toBeGreaterThan(0);
  });

  it('returns approximately 39 filters', () => {
    const filters = getDefaultFilters();

    // 10 click ID + 7 UTM paid + 1 referrer paid + 2 direct + 7 search organic + 10 social organic + 1 email + 1 default = 39
    expect(filters.length).toBe(39);
  });

  it('generates unique IDs for each filter', () => {
    const filters = getDefaultFilters();
    const ids = filters.map((f) => f.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(filters.length);
  });

  it('generates new IDs on each call', () => {
    const filters1 = getDefaultFilters();
    const filters2 = getDefaultFilters();

    // IDs should be different between calls
    expect(filters1[0].id).not.toBe(filters2[0].id);
  });

  it('all filters have valid source fields in conditions', () => {
    const filters = getDefaultFilters();

    for (const filter of filters) {
      for (const condition of filter.conditions) {
        expect(VALID_SOURCE_FIELDS.has(condition.field)).toBe(true);
      }
    }
  });

  it('all filters have valid writable dimensions in operations', () => {
    const filters = getDefaultFilters();

    for (const filter of filters) {
      for (const operation of filter.operations) {
        expect(VALID_WRITABLE_DIMENSIONS.has(operation.dimension)).toBe(true);
      }
    }
  });

  it('all filters have unique order values', () => {
    const filters = getDefaultFilters();
    const orders = filters.map((f) => f.order);
    const uniqueOrders = new Set(orders);

    expect(uniqueOrders.size).toBe(filters.length);
  });

  it('filters are ordered sequentially from 1', () => {
    const filters = getDefaultFilters();
    const orders = filters.map((f) => f.order).sort((a, b) => a - b);

    expect(orders[0]).toBe(1);
    expect(orders[orders.length - 1]).toBe(filters.length);
  });

  it('click ID filters have highest priority (900-831)', () => {
    const filters = getDefaultFilters();
    const clickIdFilters = filters.filter((f) => f.name.includes('Click ID'));

    expect(clickIdFilters.length).toBe(10);
    for (const filter of clickIdFilters) {
      expect(filter.priority).toBeGreaterThanOrEqual(831);
      expect(filter.priority).toBeLessThanOrEqual(900);
    }
  });

  it('default fallback filter has lowest priority (10)', () => {
    const filters = getDefaultFilters();
    const defaultFilter = filters.find((f) => f.name === 'Default Channel');

    expect(defaultFilter).toBeDefined();
    expect(defaultFilter!.priority).toBe(10);
  });

  it('default fallback filter uses set_default_value action', () => {
    const filters = getDefaultFilters();
    const defaultFilter = filters.find((f) => f.name === 'Default Channel');

    expect(defaultFilter).toBeDefined();
    for (const operation of defaultFilter!.operations) {
      expect(operation.action).toBe('set_default_value');
    }
  });

  it('all filters have a computed version hash', () => {
    const filters = getDefaultFilters();

    for (const filter of filters) {
      expect(filter.version).toBeDefined();
      expect(typeof filter.version).toBe('string');
      expect(filter.version.length).toBeGreaterThan(0);
    }
  });

  it('all filters share the same version hash', () => {
    const filters = getDefaultFilters();
    const versions = new Set(filters.map((f) => f.version));

    expect(versions.size).toBe(1);
  });

  it('all filters are enabled by default', () => {
    const filters = getDefaultFilters();

    for (const filter of filters) {
      expect(filter.enabled).toBe(true);
    }
  });

  it('all channel filters have the "channel" tag', () => {
    const filters = getDefaultFilters();
    const channelFilters = filters.filter((f) => f.name !== 'Default Channel');

    for (const filter of channelFilters) {
      expect(filter.tags).toContain('channel');
    }
  });

  it('default filter has the "default" tag', () => {
    const filters = getDefaultFilters();
    const defaultFilter = filters.find((f) => f.name === 'Default Channel');

    expect(defaultFilter!.tags).toContain('default');
  });

  it('includes expected paid channels', () => {
    const filters = getDefaultFilters();
    const paidChannels = [
      'google-ads',
      'facebook-ads',
      'microsoft-ads',
      'tiktok-ads',
      'pinterest-ads',
      'linkedin-ads',
      'twitter-ads',
      'instagram-ads',
      'youtube-ads',
      'snapchat-ads',
      'reddit-ads',
      'quora-ads',
    ];

    for (const channel of paidChannels) {
      const hasChannel = filters.some((f) =>
        f.operations.some((op) => op.value === channel),
      );
      expect(hasChannel).toBe(true);
    }
  });

  it('includes expected organic channels', () => {
    const filters = getDefaultFilters();
    const organicChannels = [
      'google-organic',
      'bing-organic',
      'yahoo-organic',
      'duckduckgo-organic',
      'baidu-organic',
      'yandex-organic',
      'facebook-organic',
      'instagram-organic',
      'twitter-organic',
      'linkedin-organic',
      'youtube-organic',
      'tiktok-organic',
      'pinterest-organic',
      'reddit-organic',
      'snapchat-organic',
      'quora-organic',
    ];

    for (const channel of organicChannels) {
      const hasChannel = filters.some((f) =>
        f.operations.some((op) => op.value === channel),
      );
      expect(hasChannel).toBe(true);
    }
  });

  it('includes direct and email channels', () => {
    const filters = getDefaultFilters();

    const hasDirectChannel = filters.some((f) =>
      f.operations.some((op) => op.value === 'direct'),
    );
    const hasEmailChannel = filters.some((f) =>
      f.operations.some((op) => op.value === 'email'),
    );

    expect(hasDirectChannel).toBe(true);
    expect(hasEmailChannel).toBe(true);
  });
});
