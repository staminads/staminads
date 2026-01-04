export interface ApplePage {
  path: string;
  category: 'homepage' | 'category' | 'product' | 'shop';
  productLine?: string;
  durationMultiplier: number;
  weight: number;
}

export const APPLE_PAGES: ApplePage[] = [
  // Homepage
  { path: '/', category: 'homepage', durationMultiplier: 0.6, weight: 8 },

  // Category pages
  {
    path: '/mac/',
    category: 'category',
    productLine: 'mac',
    durationMultiplier: 1.0,
    weight: 5,
  },
  {
    path: '/ipad/',
    category: 'category',
    productLine: 'ipad',
    durationMultiplier: 1.0,
    weight: 5,
  },
  {
    path: '/iphone/',
    category: 'category',
    productLine: 'iphone',
    durationMultiplier: 1.0,
    weight: 8,
  },
  {
    path: '/watch/',
    category: 'category',
    productLine: 'watch',
    durationMultiplier: 1.0,
    weight: 4,
  },
  {
    path: '/airpods/',
    category: 'category',
    productLine: 'airpods',
    durationMultiplier: 1.0,
    weight: 4,
  },
  {
    path: '/tv-home/',
    category: 'category',
    productLine: 'tv-home',
    durationMultiplier: 1.0,
    weight: 2,
  },
  {
    path: '/apple-vision-pro/',
    category: 'category',
    productLine: 'vision',
    durationMultiplier: 1.0,
    weight: 2,
  },

  // Mac products
  {
    path: '/macbook-air/',
    category: 'product',
    productLine: 'mac',
    durationMultiplier: 1.4,
    weight: 6,
  },
  {
    path: '/macbook-pro/',
    category: 'product',
    productLine: 'mac',
    durationMultiplier: 1.4,
    weight: 5,
  },
  {
    path: '/imac/',
    category: 'product',
    productLine: 'mac',
    durationMultiplier: 1.4,
    weight: 3,
  },
  {
    path: '/mac-mini/',
    category: 'product',
    productLine: 'mac',
    durationMultiplier: 1.4,
    weight: 2,
  },
  {
    path: '/mac-studio/',
    category: 'product',
    productLine: 'mac',
    durationMultiplier: 1.4,
    weight: 1,
  },
  {
    path: '/mac-pro/',
    category: 'product',
    productLine: 'mac',
    durationMultiplier: 1.4,
    weight: 1,
  },

  // iPhone products
  {
    path: '/iphone-17-pro/',
    category: 'product',
    productLine: 'iphone',
    durationMultiplier: 1.4,
    weight: 10,
  },
  {
    path: '/iphone-air/',
    category: 'product',
    productLine: 'iphone',
    durationMultiplier: 1.4,
    weight: 8,
  },
  {
    path: '/iphone-17/',
    category: 'product',
    productLine: 'iphone',
    durationMultiplier: 1.4,
    weight: 7,
  },
  {
    path: '/iphone-16e/',
    category: 'product',
    productLine: 'iphone',
    durationMultiplier: 1.4,
    weight: 4,
  },
  {
    path: '/iphone/compare/',
    category: 'product',
    productLine: 'iphone',
    durationMultiplier: 1.6,
    weight: 3,
  },

  // iPad products
  {
    path: '/ipad-pro/',
    category: 'product',
    productLine: 'ipad',
    durationMultiplier: 1.4,
    weight: 4,
  },
  {
    path: '/ipad-air/',
    category: 'product',
    productLine: 'ipad',
    durationMultiplier: 1.4,
    weight: 4,
  },
  {
    path: '/ipad-mini/',
    category: 'product',
    productLine: 'ipad',
    durationMultiplier: 1.4,
    weight: 2,
  },

  // Watch products
  {
    path: '/apple-watch-series-11/',
    category: 'product',
    productLine: 'watch',
    durationMultiplier: 1.4,
    weight: 4,
  },
  {
    path: '/apple-watch-ultra-3/',
    category: 'product',
    productLine: 'watch',
    durationMultiplier: 1.4,
    weight: 2,
  },
  {
    path: '/apple-watch-se-3/',
    category: 'product',
    productLine: 'watch',
    durationMultiplier: 1.4,
    weight: 2,
  },

  // AirPods products
  {
    path: '/airpods-pro/',
    category: 'product',
    productLine: 'airpods',
    durationMultiplier: 1.4,
    weight: 4,
  },
  {
    path: '/airpods-4/',
    category: 'product',
    productLine: 'airpods',
    durationMultiplier: 1.4,
    weight: 3,
  },
  {
    path: '/airpods-max/',
    category: 'product',
    productLine: 'airpods',
    durationMultiplier: 1.4,
    weight: 2,
  },

  // TV & Home products
  {
    path: '/apple-tv-4k/',
    category: 'product',
    productLine: 'tv-home',
    durationMultiplier: 1.4,
    weight: 2,
  },
  {
    path: '/homepod-mini/',
    category: 'product',
    productLine: 'tv-home',
    durationMultiplier: 1.4,
    weight: 2,
  },

  // Shop pages
  {
    path: '/us/shop/goto/buy_iphone',
    category: 'shop',
    productLine: 'iphone',
    durationMultiplier: 0.8,
    weight: 5,
  },
  {
    path: '/us/shop/goto/buy_mac',
    category: 'shop',
    productLine: 'mac',
    durationMultiplier: 0.8,
    weight: 3,
  },
  {
    path: '/us/shop/goto/buy_ipad',
    category: 'shop',
    productLine: 'ipad',
    durationMultiplier: 0.8,
    weight: 2,
  },
  {
    path: '/us/shop/goto/buy_watch',
    category: 'shop',
    productLine: 'watch',
    durationMultiplier: 0.8,
    weight: 2,
  },
];

// Pre-compute total weight for weighted random selection
export const APPLE_PAGES_TOTAL_WEIGHT = APPLE_PAGES.reduce(
  (sum, page) => sum + page.weight,
  0,
);

// iPhone launch specific pages (for traffic spike)
export const IPHONE_LAUNCH_PAGES = APPLE_PAGES.filter(
  (page) =>
    page.path.includes('iphone-17') ||
    page.path.includes('iphone-air') ||
    page.path === '/iphone/',
);

export const IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT = IPHONE_LAUNCH_PAGES.reduce(
  (sum, page) => sum + page.weight,
  0,
);
