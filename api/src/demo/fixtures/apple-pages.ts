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

// Product prices for goal generation
export interface ProductPrice {
  minPrice: number;
  maxPrice: number;
  productSlug: string;
}

export const PRODUCT_PRICES: Record<string, ProductPrice> = {
  // iPhone
  '/iphone-17-pro/': {
    minPrice: 999,
    maxPrice: 1199,
    productSlug: 'iphone-17-pro',
  },
  '/iphone-air/': { minPrice: 999, maxPrice: 999, productSlug: 'iphone-air' },
  '/iphone-17/': { minPrice: 799, maxPrice: 799, productSlug: 'iphone-17' },
  '/iphone-16e/': { minPrice: 599, maxPrice: 599, productSlug: 'iphone-16e' },
  // Mac
  '/macbook-air/': {
    minPrice: 999,
    maxPrice: 1299,
    productSlug: 'macbook-air',
  },
  '/macbook-pro/': {
    minPrice: 1599,
    maxPrice: 2499,
    productSlug: 'macbook-pro',
  },
  '/imac/': { minPrice: 1299, maxPrice: 1299, productSlug: 'imac' },
  '/mac-mini/': { minPrice: 599, maxPrice: 599, productSlug: 'mac-mini' },
  '/mac-studio/': {
    minPrice: 1999,
    maxPrice: 3999,
    productSlug: 'mac-studio',
  },
  '/mac-pro/': { minPrice: 5999, maxPrice: 6999, productSlug: 'mac-pro' },
  // iPad
  '/ipad-pro/': { minPrice: 999, maxPrice: 1299, productSlug: 'ipad-pro' },
  '/ipad-air/': { minPrice: 599, maxPrice: 599, productSlug: 'ipad-air' },
  '/ipad-mini/': { minPrice: 499, maxPrice: 499, productSlug: 'ipad-mini' },
  // Watch
  '/apple-watch-series-11/': {
    minPrice: 399,
    maxPrice: 399,
    productSlug: 'apple-watch-series-11',
  },
  '/apple-watch-ultra-3/': {
    minPrice: 799,
    maxPrice: 799,
    productSlug: 'apple-watch-ultra-3',
  },
  '/apple-watch-se-3/': {
    minPrice: 249,
    maxPrice: 249,
    productSlug: 'apple-watch-se-3',
  },
  // AirPods
  '/airpods-pro/': { minPrice: 249, maxPrice: 249, productSlug: 'airpods-pro' },
  '/airpods-4/': { minPrice: 129, maxPrice: 129, productSlug: 'airpods-4' },
  '/airpods-max/': { minPrice: 549, maxPrice: 549, productSlug: 'airpods-max' },
  // TV & Home
  '/apple-tv-4k/': {
    minPrice: 129,
    maxPrice: 149,
    productSlug: 'apple-tv-4k',
  },
  '/homepod-mini/': {
    minPrice: 99,
    maxPrice: 99,
    productSlug: 'homepod-mini',
  },
};

export function getProductPrice(path: string): ProductPrice | null {
  return PRODUCT_PRICES[path] || null;
}

export function generateRandomPrice(priceInfo: ProductPrice): number {
  if (priceInfo.minPrice === priceInfo.maxPrice) return priceInfo.minPrice;
  const range = priceInfo.maxPrice - priceInfo.minPrice;
  return priceInfo.minPrice + Math.round((Math.random() * range) / 100) * 100;
}
