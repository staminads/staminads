import * as crypto from 'crypto';
import {
  FilterDefinition,
  FilterCondition,
} from '../../filters/entities/filter.entity';
import { computeFilterVersion } from '../../filters/lib/filter-evaluator';

/**
 * Helper to create UTM-based conditions.
 */
function utmConditions(source: string, medium: string): FilterCondition[] {
  return [
    { field: 'utm_source', operator: 'regex', value: `^${source}$` },
    { field: 'utm_medium', operator: 'regex', value: `^${medium}$` },
  ];
}

/**
 * Helper to create utm_id_from condition (for click ID detection).
 */
function clickIdCondition(
  value: string,
  operator: 'equals' | 'regex' = 'equals',
): FilterCondition[] {
  return [{ field: 'utm_id_from', operator, value }];
}

/**
 * Helper to create referrer-based condition with contains operator.
 */
function referrerContains(domain: string): FilterCondition[] {
  return [{ field: 'referrer_domain', operator: 'contains', value: domain }];
}

/**
 * Helper to create referrer-based condition with regex operator.
 */
function referrerRegex(pattern: string): FilterCondition[] {
  return [{ field: 'referrer_domain', operator: 'regex', value: pattern }];
}

/**
 * Helper to create direct traffic condition.
 */
function directCondition(): FilterCondition[] {
  return [{ field: 'is_direct', operator: 'equals', value: 'true' }];
}

let filterIndex = 0;

/**
 * Helper to create a filter with both Channel Group and Channel operations.
 */
function createChannelFilter(
  name: string,
  conditions: FilterCondition[],
  channelGroup: string,
  channel: string,
  priority: number,
): FilterDefinition {
  const now = new Date().toISOString();
  filterIndex++;
  return {
    id: crypto.randomUUID(),
    name,
    priority,
    order: filterIndex,
    tags: ['channel'],
    conditions,
    operations: [
      { dimension: 'channel_group', action: 'set_value', value: channelGroup },
      { dimension: 'channel', action: 'set_value', value: channel },
    ],
    enabled: true,
    version: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get default traffic source filters for new workspaces.
 * These filters provide comprehensive channel attribution out-of-the-box.
 *
 * Each call generates fresh UUIDs for filter IDs, ensuring each workspace
 * has unique filter identifiers.
 */
export function getDefaultFilters(): FilterDefinition[] {
  filterIndex = 0;
  const filters: FilterDefinition[] = [];

  // === PAID CHANNELS VIA CLICK ID (highest priority 900-870) ===
  // These detect paid traffic using platform-specific click IDs

  filters.push(
    createChannelFilter(
      'Google Ads (Click ID)',
      clickIdCondition('^(gclid|gbraid|wbraid)$', 'regex'),
      'search-paid',
      'google-ads',
      900,
    ),
    createChannelFilter(
      'Facebook Ads (Click ID)',
      clickIdCondition('fbclid'),
      'social-paid',
      'facebook-ads',
      890,
    ),
    createChannelFilter(
      'Microsoft Ads (Click ID)',
      clickIdCondition('msclkid'),
      'search-paid',
      'microsoft-ads',
      880,
    ),
    createChannelFilter(
      'TikTok Ads (Click ID)',
      clickIdCondition('ttclid'),
      'social-paid',
      'tiktok-ads',
      870,
    ),
    createChannelFilter(
      'Pinterest Ads (Click ID)',
      clickIdCondition('epik'),
      'social-paid',
      'pinterest-ads',
      860,
    ),
    createChannelFilter(
      'LinkedIn Ads (Click ID)',
      clickIdCondition('li_fat_id'),
      'social-paid',
      'linkedin-ads',
      850,
    ),
    createChannelFilter(
      'Twitter Ads (Click ID)',
      clickIdCondition('twclid'),
      'social-paid',
      'twitter-ads',
      840,
    ),
    createChannelFilter(
      'Snapchat Ads (Click ID)',
      clickIdCondition('ScCid'),
      'social-paid',
      'snapchat-ads',
      835,
    ),
    createChannelFilter(
      'Reddit Ads (Click ID)',
      clickIdCondition('rdt_cid'),
      'social-paid',
      'reddit-ads',
      833,
    ),
    createChannelFilter(
      'Quora Ads (Click ID)',
      clickIdCondition('qclid'),
      'social-paid',
      'quora-ads',
      831,
    ),
  );

  // === PAID CHANNELS VIA UTM (priority 830-780) ===
  // Fallback for paid traffic using UTM parameters

  filters.push(
    createChannelFilter(
      'Google Ads (UTM)',
      utmConditions('google', '(cpc|ppc|paid)'),
      'search-paid',
      'google-ads',
      830,
    ),
    createChannelFilter(
      'Microsoft Ads (UTM)',
      utmConditions('(bing|microsoft)', '(cpc|ppc|paid)'),
      'search-paid',
      'microsoft-ads',
      820,
    ),
    createChannelFilter(
      'Facebook Ads (UTM)',
      utmConditions('facebook', '(cpc|paid|paidsocial)'),
      'social-paid',
      'facebook-ads',
      810,
    ),
    createChannelFilter(
      'Instagram Ads (UTM)',
      utmConditions('instagram', '(cpc|paid|paidsocial)'),
      'social-paid',
      'instagram-ads',
      800,
    ),
    createChannelFilter(
      'LinkedIn Ads (UTM)',
      utmConditions('linkedin', '(cpc|paid|paidsocial)'),
      'social-paid',
      'linkedin-ads',
      790,
    ),
    createChannelFilter(
      'TikTok Ads (UTM)',
      utmConditions('tiktok', '(cpc|paid|paidsocial)'),
      'social-paid',
      'tiktok-ads',
      780,
    ),
    createChannelFilter(
      'YouTube Ads (UTM)',
      utmConditions('youtube', '(cpc|cpv|paid)'),
      'video-paid',
      'youtube-ads',
      770,
    ),
  );

  // === PAID CHANNELS VIA REFERRER (priority 760) ===
  // Fallback for Google Ads Display network traffic

  filters.push(
    createChannelFilter(
      'Google Ads (Referrer)',
      referrerContains('googleadservices'),
      'display-banner',
      'google-ads',
      760,
    ),
  );

  // === DIRECT TRAFFIC (priority 750-740) ===

  filters.push(
    createChannelFilter(
      'Direct (UTM)',
      utmConditions('direct', 'none'),
      'direct',
      'direct',
      750,
    ),
    createChannelFilter(
      'Direct Traffic',
      directCondition(),
      'direct',
      'direct',
      740,
    ),
  );

  // === ORGANIC SEARCH ENGINES (priority 700-650) ===

  filters.push(
    // Android Google Search app (must be before generic google match)
    createChannelFilter(
      'Google Android App',
      referrerContains('com.google.android'),
      'search-organic',
      'google-organic',
      705,
    ),
    createChannelFilter(
      'Google Organic',
      referrerContains('google'),
      'search-organic',
      'google-organic',
      700,
    ),
    createChannelFilter(
      'Bing Organic',
      referrerContains('bing'),
      'search-organic',
      'bing-organic',
      690,
    ),
    createChannelFilter(
      'Yahoo Organic',
      referrerContains('yahoo'),
      'search-organic',
      'yahoo-organic',
      680,
    ),
    createChannelFilter(
      'DuckDuckGo Organic',
      referrerContains('duckduckgo'),
      'search-organic',
      'duckduckgo-organic',
      670,
    ),
    createChannelFilter(
      'Baidu Organic',
      referrerContains('baidu'),
      'search-organic',
      'baidu-organic',
      660,
    ),
    createChannelFilter(
      'Yandex Organic',
      referrerContains('yandex'),
      'search-organic',
      'yandex-organic',
      650,
    ),
  );

  // === SOCIAL ORGANIC (priority 600-530) ===

  filters.push(
    createChannelFilter(
      'Facebook Organic',
      referrerContains('facebook'),
      'social-organic',
      'facebook-organic',
      600,
    ),
    createChannelFilter(
      'Instagram Organic',
      referrerContains('instagram'),
      'social-organic',
      'instagram-organic',
      590,
    ),
    createChannelFilter(
      'Twitter/X Organic',
      referrerRegex('(twitter\\.com|x\\.com|t\\.co)'),
      'social-organic',
      'twitter-organic',
      580,
    ),
    createChannelFilter(
      'LinkedIn Organic',
      referrerContains('linkedin'),
      'social-organic',
      'linkedin-organic',
      570,
    ),
    createChannelFilter(
      'YouTube Organic',
      referrerContains('youtube'),
      'social-organic',
      'youtube-organic',
      560,
    ),
    createChannelFilter(
      'TikTok Organic',
      referrerContains('tiktok'),
      'social-organic',
      'tiktok-organic',
      550,
    ),
    createChannelFilter(
      'Pinterest Organic',
      referrerContains('pinterest'),
      'social-organic',
      'pinterest-organic',
      540,
    ),
    createChannelFilter(
      'Reddit Organic',
      referrerContains('reddit'),
      'social-organic',
      'reddit-organic',
      530,
    ),
    createChannelFilter(
      'Snapchat Organic',
      referrerContains('snapchat'),
      'social-organic',
      'snapchat-organic',
      520,
    ),
    createChannelFilter(
      'Quora Organic',
      referrerContains('quora'),
      'social-organic',
      'quora-organic',
      510,
    ),
  );

  // === EMAIL MARKETING (priority 300) ===

  const now = new Date().toISOString();
  filterIndex++;
  filters.push({
    id: crypto.randomUUID(),
    name: 'Email',
    priority: 300,
    order: filterIndex,
    tags: ['channel'],
    conditions: [{ field: 'utm_medium', operator: 'regex', value: '^email$' }],
    operations: [
      { dimension: 'channel_group', action: 'set_value', value: 'email' },
      { dimension: 'channel', action: 'set_value', value: 'email' },
    ],
    enabled: true,
    version: '',
    createdAt: now,
    updatedAt: now,
  });

  // === DEFAULT FALLBACK (lowest priority 10) ===

  filterIndex++;
  filters.push({
    id: crypto.randomUUID(),
    name: 'Default Channel',
    priority: 10,
    order: filterIndex,
    tags: ['default'],
    conditions: [], // Always matches
    operations: [
      {
        dimension: 'channel_group',
        action: 'set_default_value',
        value: 'not-mapped',
      },
      {
        dimension: 'channel',
        action: 'set_default_value',
        value: 'not-mapped',
      },
    ],
    enabled: true,
    version: '',
    createdAt: now,
    updatedAt: now,
  });

  // Compute version hash for all filters
  const version = computeFilterVersion(filters);
  return filters.map((f) => ({ ...f, version }));
}
