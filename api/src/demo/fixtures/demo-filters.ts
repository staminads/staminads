import * as crypto from 'crypto';
import { FilterDefinition, FilterCondition } from '../../filters/entities/filter.entity';
import { computeFilterVersion } from '../../filters/lib/filter-evaluator';

/**
 * Demo custom dimension labels.
 * Note: channel and channel_group are now first-class dimensions,
 * so only cd_1 (Product Category) needs a label.
 */
export const DEMO_CUSTOM_DIMENSION_LABELS: Record<string, string> = {
  '1': 'Product Category',
};

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
 * Helper to create referrer-based condition.
 */
function referrerCondition(domain: string): FilterCondition[] {
  return [{ field: 'referrer_domain', operator: 'equals', value: domain }];
}

/**
 * Helper to create direct traffic condition.
 */
function directCondition(): FilterCondition[] {
  return [{ field: 'is_direct', operator: 'equals', value: 'true' }];
}

/**
 * Helper to create landing path condition.
 */
function pathCondition(pathPattern: string): FilterCondition[] {
  return [{ field: 'landing_path', operator: 'regex', value: pathPattern }];
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
  priority: number = 500,
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
 * Helper to create a filter for Product Category only.
 */
function createProductFilter(
  name: string,
  conditions: FilterCondition[],
  category: string,
  priority: number = 400,
): FilterDefinition {
  const now = new Date().toISOString();
  filterIndex++;
  return {
    id: crypto.randomUUID(),
    name,
    priority,
    order: filterIndex,
    tags: ['product category'],
    conditions,
    operations: [{ dimension: 'cd_1', action: 'set_value', value: category }],
    enabled: true,
    version: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get all demo filters for Channel Group, Channel, and Product Category.
 */
export function getDemoFilters(): FilterDefinition[] {
  filterIndex = 0;
  const filters: FilterDefinition[] = [];

  // === CHANNEL FILTERS (higher priority) ===

  // 1. UTM-based paid channels (highest priority)
  filters.push(
    createChannelFilter('Google Ads', utmConditions('google', 'cpc'), 'search-paid', 'google-ads', 900),
    createChannelFilter('Facebook Ads', utmConditions('facebook', 'social'), 'social-paid', 'facebook-ads', 890),
    createChannelFilter('Instagram Ads', utmConditions('instagram', 'social'), 'social-paid', 'instagram-ads', 880),
  );

  // 2. UTM-based organic/other channels
  filters.push(
    createChannelFilter('Twitter UTM', utmConditions('twitter', 'social'), 'social-organic', 'twitter', 800),
    createChannelFilter('Email UTM', utmConditions('email', 'email'), 'email-organic', 'email', 790),
    createChannelFilter('Display UTM', utmConditions('display', 'display'), 'display-banner', 'display', 780),
    createChannelFilter('Affiliate UTM', utmConditions('affiliate', 'referral'), 'referral', 'affiliate', 770),
  );

  // 3. Direct traffic
  filters.push(
    createChannelFilter('Direct UTM', utmConditions('direct', 'none'), 'direct', 'direct', 750),
    createChannelFilter('Direct Traffic', directCondition(), 'direct', 'direct', 740),
  );

  // 4. Referrer-based search engines
  filters.push(
    createChannelFilter('Google Organic', referrerCondition('google.com'), 'search-organic', 'google-organic', 600),
    createChannelFilter('Bing Organic', referrerCondition('bing.com'), 'search-organic', 'bing-organic', 590),
    createChannelFilter('Yahoo Organic', referrerCondition('yahoo.com'), 'search-organic', 'yahoo-organic', 580),
    createChannelFilter('DuckDuckGo Organic', referrerCondition('duckduckgo.com'), 'search-organic', 'duckduckgo-organic', 570),
    createChannelFilter('Baidu Organic', referrerCondition('baidu.com'), 'search-organic', 'baidu-organic', 560),
  );

  // 5. Referrer-based social media
  filters.push(
    createChannelFilter('Facebook Organic', referrerCondition('facebook.com'), 'social-organic', 'facebook-organic', 550),
    createChannelFilter('Twitter Referral', referrerCondition('twitter.com'), 'social-organic', 'twitter', 540),
    createChannelFilter('Instagram Organic', referrerCondition('instagram.com'), 'social-organic', 'instagram-organic', 530),
    createChannelFilter('LinkedIn Referral', referrerCondition('linkedin.com'), 'social-organic', 'linkedin', 520),
    createChannelFilter('YouTube Referral', referrerCondition('youtube.com'), 'social-organic', 'youtube', 510),
    createChannelFilter('Reddit Referral', referrerCondition('reddit.com'), 'social-organic', 'reddit', 500),
    createChannelFilter('Pinterest Referral', referrerCondition('pinterest.com'), 'social-organic', 'pinterest', 490),
    createChannelFilter('TikTok Referral', referrerCondition('tiktok.com'), 'social-organic', 'tiktok', 480),
  );

  // 6. Tech news sites
  filters.push(
    createChannelFilter('MacRumors', referrerCondition('macrumors.com'), 'tech-news', 'macrumors', 450),
    createChannelFilter('9to5Mac', referrerCondition('9to5mac.com'), 'tech-news', '9to5mac', 440),
    createChannelFilter('The Verge', referrerCondition('theverge.com'), 'tech-news', 'theverge', 430),
    createChannelFilter('CNET', referrerCondition('cnet.com'), 'tech-news', 'cnet', 420),
    createChannelFilter('TechCrunch', referrerCondition('techcrunch.com'), 'tech-news', 'techcrunch', 410),
    createChannelFilter('Engadget', referrerCondition('engadget.com'), 'tech-news', 'engadget', 400),
    createChannelFilter('Wired', referrerCondition('wired.com'), 'tech-news', 'wired', 390),
  );

  // 7. Retailers
  filters.push(
    createChannelFilter('Amazon', referrerCondition('amazon.com'), 'referral', 'amazon', 350),
    createChannelFilter('Best Buy', referrerCondition('bestbuy.com'), 'referral', 'bestbuy', 340),
    createChannelFilter('Target', referrerCondition('target.com'), 'referral', 'target', 330),
    createChannelFilter('Walmart', referrerCondition('walmart.com'), 'referral', 'walmart', 320),
  );

  // 8. Internal (apple.com)
  filters.push(
    createChannelFilter('Apple Internal', referrerCondition('apple.com'), 'direct', 'direct', 300),
  );

  // === PRODUCT CATEGORY FILTERS ===

  // iPhone pages
  filters.push(
    createProductFilter('iPhone 17 Pro', pathCondition('^/iphone-17-pro/'), 'iPhone', 450),
    createProductFilter('iPhone Air', pathCondition('^/iphone-air/'), 'iPhone', 440),
    createProductFilter('iPhone 17', pathCondition('^/iphone-17/'), 'iPhone', 430),
    createProductFilter('iPhone 16e', pathCondition('^/iphone-16e/'), 'iPhone', 420),
    createProductFilter('iPhone Compare', pathCondition('^/iphone/compare/'), 'iPhone', 410),
    createProductFilter('iPhone General', pathCondition('^/iphone/'), 'iPhone', 400),
    createProductFilter('Buy iPhone', pathCondition('/buy_iphone'), 'iPhone', 390),
  );

  // Mac pages
  filters.push(
    createProductFilter('MacBook Air', pathCondition('^/macbook-air/'), 'Mac', 380),
    createProductFilter('MacBook Pro', pathCondition('^/macbook-pro/'), 'Mac', 370),
    createProductFilter('iMac', pathCondition('^/imac/'), 'Mac', 360),
    createProductFilter('Mac mini', pathCondition('^/mac-mini/'), 'Mac', 350),
    createProductFilter('Mac Studio', pathCondition('^/mac-studio/'), 'Mac', 340),
    createProductFilter('Mac Pro', pathCondition('^/mac-pro/'), 'Mac', 330),
    createProductFilter('Mac General', pathCondition('^/mac/'), 'Mac', 320),
    createProductFilter('Buy Mac', pathCondition('/buy_mac'), 'Mac', 310),
  );

  // iPad pages
  filters.push(
    createProductFilter('iPad Pro', pathCondition('^/ipad-pro/'), 'iPad', 300),
    createProductFilter('iPad Air', pathCondition('^/ipad-air/'), 'iPad', 290),
    createProductFilter('iPad mini', pathCondition('^/ipad-mini/'), 'iPad', 280),
    createProductFilter('iPad General', pathCondition('^/ipad/'), 'iPad', 270),
    createProductFilter('Buy iPad', pathCondition('/buy_ipad'), 'iPad', 260),
  );

  // Watch pages
  filters.push(
    createProductFilter('Apple Watch Series 11', pathCondition('^/apple-watch-series-11/'), 'Watch', 250),
    createProductFilter('Apple Watch Ultra 3', pathCondition('^/apple-watch-ultra-3/'), 'Watch', 240),
    createProductFilter('Apple Watch SE 3', pathCondition('^/apple-watch-se-3/'), 'Watch', 230),
    createProductFilter('Watch General', pathCondition('^/watch/'), 'Watch', 220),
    createProductFilter('Buy Watch', pathCondition('/buy_watch'), 'Watch', 210),
  );

  // AirPods pages
  filters.push(
    createProductFilter('AirPods Pro', pathCondition('^/airpods-pro/'), 'AirPods', 200),
    createProductFilter('AirPods 4', pathCondition('^/airpods-4/'), 'AirPods', 190),
    createProductFilter('AirPods Max', pathCondition('^/airpods-max/'), 'AirPods', 180),
    createProductFilter('AirPods General', pathCondition('^/airpods/'), 'AirPods', 170),
  );

  // TV & Home pages
  filters.push(
    createProductFilter('Apple TV 4K', pathCondition('^/apple-tv-4k/'), 'TV & Home', 160),
    createProductFilter('HomePod mini', pathCondition('^/homepod-mini/'), 'TV & Home', 150),
    createProductFilter('TV & Home General', pathCondition('^/tv-home/'), 'TV & Home', 140),
  );

  // Vision Pro pages
  filters.push(
    createProductFilter('Vision Pro', pathCondition('^/apple-vision-pro/'), 'Vision Pro', 130),
  );

  // Homepage
  filters.push(
    createProductFilter('Homepage', pathCondition('^/$'), 'Homepage', 100),
  );

  // === DEFAULT FILTERS (lowest priority) ===
  const now = new Date().toISOString();
  filterIndex++;
  filters.push({
    id: crypto.randomUUID(),
    name: 'Default Channel',
    priority: 10,
    order: filterIndex,
    tags: ['default'],
    conditions: [], // Always matches
    operations: [
      { dimension: 'channel_group', action: 'set_default_value', value: 'not-mapped' },
      { dimension: 'channel', action: 'set_default_value', value: 'not-mapped' },
    ],
    enabled: true,
    version: '',
    createdAt: now,
    updatedAt: now,
  });

  filterIndex++;
  filters.push({
    id: crypto.randomUUID(),
    name: 'Default Product',
    priority: 5,
    order: filterIndex,
    tags: ['default'],
    conditions: [], // Always matches
    operations: [{ dimension: 'cd_1', action: 'set_default_value', value: 'Other' }],
    enabled: true,
    version: '',
    createdAt: now,
    updatedAt: now,
  });

  // Compute version hash for each filter
  const version = computeFilterVersion(filters);
  return filters.map((f) => ({ ...f, version }));
}
