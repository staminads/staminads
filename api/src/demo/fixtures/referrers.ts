export interface Referrer {
  domain: string | null;
  path?: string;
  category:
    | 'search'
    | 'social'
    | 'tech-news'
    | 'retailer'
    | 'direct'
    | 'internal'
    | 'other';
  channelGroup: string;
  durationMultiplier: number;
  weight: number;
}

export const REFERRERS: Referrer[] = [
  // Direct traffic (no referrer)
  {
    domain: null,
    category: 'direct',
    channelGroup: 'Direct',
    durationMultiplier: 1.3,
    weight: 20,
  },

  // Search engines
  {
    domain: 'google.com',
    path: '/search',
    category: 'search',
    channelGroup: 'Organic Search',
    durationMultiplier: 1.2,
    weight: 25,
  },
  {
    domain: 'bing.com',
    path: '/search',
    category: 'search',
    channelGroup: 'Organic Search',
    durationMultiplier: 1.1,
    weight: 5,
  },
  {
    domain: 'yahoo.com',
    path: '/search',
    category: 'search',
    channelGroup: 'Organic Search',
    durationMultiplier: 1.0,
    weight: 2,
  },
  {
    domain: 'duckduckgo.com',
    category: 'search',
    channelGroup: 'Organic Search',
    durationMultiplier: 1.3,
    weight: 2,
  },
  {
    domain: 'baidu.com',
    category: 'search',
    channelGroup: 'Organic Search',
    durationMultiplier: 1.1,
    weight: 2,
  },

  // Social media
  {
    domain: 'facebook.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 0.8,
    weight: 5,
  },
  {
    domain: 'twitter.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 0.75,
    weight: 3,
  },
  {
    domain: 'instagram.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 0.7,
    weight: 4,
  },
  {
    domain: 'linkedin.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 1.4,
    weight: 2,
  },
  {
    domain: 'youtube.com',
    path: '/watch',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 1.1,
    weight: 4,
  },
  {
    domain: 'reddit.com',
    path: '/r/apple',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 1.2,
    weight: 3,
  },
  {
    domain: 'pinterest.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 0.9,
    weight: 1,
  },
  {
    domain: 'tiktok.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 0.7,
    weight: 3,
  },

  // Tech news sites
  {
    domain: 'macrumors.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.6,
    weight: 3,
  },
  {
    domain: '9to5mac.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.6,
    weight: 3,
  },
  {
    domain: 'theverge.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.5,
    weight: 2,
  },
  {
    domain: 'cnet.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.4,
    weight: 2,
  },
  {
    domain: 'techcrunch.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.5,
    weight: 1,
  },
  {
    domain: 'engadget.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.4,
    weight: 1,
  },
  {
    domain: 'wired.com',
    category: 'tech-news',
    channelGroup: 'Referral',
    durationMultiplier: 1.5,
    weight: 1,
  },

  // Retailers
  {
    domain: 'amazon.com',
    category: 'retailer',
    channelGroup: 'Referral',
    durationMultiplier: 0.9,
    weight: 2,
  },
  {
    domain: 'bestbuy.com',
    category: 'retailer',
    channelGroup: 'Referral',
    durationMultiplier: 1.0,
    weight: 1,
  },
  {
    domain: 'target.com',
    category: 'retailer',
    channelGroup: 'Referral',
    durationMultiplier: 0.9,
    weight: 1,
  },
  {
    domain: 'walmart.com',
    category: 'retailer',
    channelGroup: 'Referral',
    durationMultiplier: 0.8,
    weight: 1,
  },

  // Uncategorized sources (will show as "not-mapped" in channel filters)
  {
    domain: 'news.ycombinator.com',
    category: 'other',
    channelGroup: 'Referral',
    durationMultiplier: 1.5,
    weight: 2,
  },
  {
    domain: 'slickdeals.net',
    category: 'other',
    channelGroup: 'Referral',
    durationMultiplier: 0.6,
    weight: 1,
  },
  {
    domain: 'quora.com',
    category: 'other',
    channelGroup: 'Referral',
    durationMultiplier: 1.1,
    weight: 1,
  },
  {
    domain: 'medium.com',
    category: 'other',
    channelGroup: 'Referral',
    durationMultiplier: 1.3,
    weight: 1,
  },

  // Internal navigation
  {
    domain: 'apple.com',
    category: 'internal',
    channelGroup: 'Direct',
    durationMultiplier: 1.2,
    weight: 5,
  },
];

// Pre-compute total weight
export const REFERRERS_TOTAL_WEIGHT = REFERRERS.reduce(
  (sum, ref) => sum + ref.weight,
  0,
);

// Tech news referrers for iPhone launch spike
export const TECH_NEWS_REFERRERS = REFERRERS.filter(
  (ref) => ref.category === 'tech-news',
);
export const TECH_NEWS_TOTAL_WEIGHT = TECH_NEWS_REFERRERS.reduce(
  (sum, ref) => sum + ref.weight,
  0,
);
