export interface DeviceProfile {
  os: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
  browserType: string | null; // crawler, inapp, email, fetcher, cli, mediaplayer, module, or null for standard
  device: 'desktop' | 'mobile' | 'tablet';
  deviceVendor: string | null;
  deviceModel: string | null;
  screenWidth: number;
  screenHeight: number;
  userAgent: string;
  durationMultiplier: number;
  weight: number;
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  // macOS Desktop - Safari
  {
    os: 'macOS',
    osVersion: '15.1',
    browser: 'Safari',
    browserVersion: '18.1',
    browserType: null,
    device: 'desktop',
    deviceVendor: 'Apple',
    deviceModel: null,
    screenWidth: 1920,
    screenHeight: 1080,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    durationMultiplier: 1.4, // Safari + Desktop
    weight: 15,
  },
  {
    os: 'macOS',
    osVersion: '14.5',
    browser: 'Safari',
    browserVersion: '17.5',
    browserType: null,
    device: 'desktop',
    deviceVendor: 'Apple',
    deviceModel: null,
    screenWidth: 2560,
    screenHeight: 1440,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    durationMultiplier: 1.4,
    weight: 8,
  },
  // macOS Desktop - Chrome
  {
    os: 'macOS',
    osVersion: '15.1',
    browser: 'Chrome',
    browserVersion: '120.0',
    browserType: null,
    device: 'desktop',
    deviceVendor: 'Apple',
    deviceModel: null,
    screenWidth: 1920,
    screenHeight: 1080,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    durationMultiplier: 1.3, // Chrome + Desktop
    weight: 8,
  },
  // macOS Desktop - Firefox
  {
    os: 'macOS',
    osVersion: '15.0',
    browser: 'Firefox',
    browserVersion: '121.0',
    browserType: null,
    device: 'desktop',
    deviceVendor: 'Apple',
    deviceModel: null,
    screenWidth: 1680,
    screenHeight: 1050,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:121.0) Gecko/20100101 Firefox/121.0',
    durationMultiplier: 1.43, // Firefox 1.1 * Desktop 1.3
    weight: 3,
  },

  // iOS Mobile - Safari
  {
    os: 'iOS',
    osVersion: '18.1',
    browser: 'Safari',
    browserVersion: '18.1',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Apple',
    deviceModel: 'iPhone 16 Pro',
    screenWidth: 430,
    screenHeight: 932,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    durationMultiplier: 1.4, // Safari (mobile baseline is 1.0)
    weight: 12,
  },
  {
    os: 'iOS',
    osVersion: '18.0',
    browser: 'Safari',
    browserVersion: '18.0',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Apple',
    deviceModel: 'iPhone 15 Pro Max',
    screenWidth: 430,
    screenHeight: 932,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    durationMultiplier: 1.4,
    weight: 10,
  },
  {
    os: 'iOS',
    osVersion: '17.6',
    browser: 'Safari',
    browserVersion: '17.6',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Apple',
    deviceModel: 'iPhone 14',
    screenWidth: 390,
    screenHeight: 844,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    durationMultiplier: 1.4,
    weight: 8,
  },
  // iOS Mobile - Chrome
  {
    os: 'iOS',
    osVersion: '18.1',
    browser: 'Chrome',
    browserVersion: '120.0',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Apple',
    deviceModel: 'iPhone 16',
    screenWidth: 393,
    screenHeight: 852,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
    durationMultiplier: 1.0,
    weight: 4,
  },

  // iPad Tablet - Safari (high engagement)
  {
    os: 'iPadOS',
    osVersion: '18.1',
    browser: 'Safari',
    browserVersion: '18.1',
    browserType: null,
    device: 'tablet',
    deviceVendor: 'Apple',
    deviceModel: 'iPad Pro 12.9"',
    screenWidth: 1024,
    screenHeight: 1366,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    durationMultiplier: 2.52, // Tablet 1.8 * Safari 1.4
    weight: 5,
  },
  {
    os: 'iPadOS',
    osVersion: '17.5',
    browser: 'Safari',
    browserVersion: '17.5',
    browserType: null,
    device: 'tablet',
    deviceVendor: 'Apple',
    deviceModel: 'iPad Air',
    screenWidth: 820,
    screenHeight: 1180,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    durationMultiplier: 2.52,
    weight: 4,
  },

  // Windows Desktop - Chrome
  {
    os: 'Windows',
    osVersion: '11',
    browser: 'Chrome',
    browserVersion: '120.0',
    browserType: null,
    device: 'desktop',
    deviceVendor: null,
    deviceModel: null,
    screenWidth: 1920,
    screenHeight: 1080,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    durationMultiplier: 1.3,
    weight: 10,
  },
  {
    os: 'Windows',
    osVersion: '10',
    browser: 'Chrome',
    browserVersion: '119.0',
    browserType: null,
    device: 'desktop',
    deviceVendor: null,
    deviceModel: null,
    screenWidth: 1366,
    screenHeight: 768,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    durationMultiplier: 1.3,
    weight: 5,
  },
  // Windows Desktop - Edge
  {
    os: 'Windows',
    osVersion: '11',
    browser: 'Edge',
    browserVersion: '120.0',
    browserType: null,
    device: 'desktop',
    deviceVendor: null,
    deviceModel: null,
    screenWidth: 1920,
    screenHeight: 1080,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    durationMultiplier: 1.17, // Edge 0.9 * Desktop 1.3
    weight: 4,
  },
  // Windows Desktop - Firefox
  {
    os: 'Windows',
    osVersion: '11',
    browser: 'Firefox',
    browserVersion: '121.0',
    browserType: null,
    device: 'desktop',
    deviceVendor: null,
    deviceModel: null,
    screenWidth: 1920,
    screenHeight: 1080,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    durationMultiplier: 1.43,
    weight: 3,
  },

  // Android Mobile - Chrome
  {
    os: 'Android',
    osVersion: '14',
    browser: 'Chrome',
    browserVersion: '120.0',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Samsung',
    deviceModel: 'Galaxy S24 Ultra',
    screenWidth: 412,
    screenHeight: 915,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
    durationMultiplier: 1.0,
    weight: 5,
  },
  {
    os: 'Android',
    osVersion: '14',
    browser: 'Chrome',
    browserVersion: '120.0',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Google',
    deviceModel: 'Pixel 8 Pro',
    screenWidth: 412,
    screenHeight: 892,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
    durationMultiplier: 1.0,
    weight: 3,
  },
  {
    os: 'Android',
    osVersion: '13',
    browser: 'Samsung Browser',
    browserVersion: '23.0',
    browserType: null,
    device: 'mobile',
    deviceVendor: 'Samsung',
    deviceModel: 'Galaxy S23',
    screenWidth: 360,
    screenHeight: 780,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
    durationMultiplier: 0.95,
    weight: 2,
  },
];

// Pre-compute total weight
export const DEVICE_PROFILES_TOTAL_WEIGHT = DEVICE_PROFILES.reduce(
  (sum, device) => sum + device.weight,
  0,
);

// Browser multipliers (for reference/use in generator)
export const BROWSER_MULTIPLIERS: Record<string, number> = {
  Safari: 1.4,
  Chrome: 1.0,
  Firefox: 1.1,
  Edge: 0.9,
  'Samsung Browser': 0.95,
};

// Device type multipliers
export const DEVICE_TYPE_MULTIPLIERS: Record<string, number> = {
  tablet: 1.8,
  desktop: 1.3,
  mobile: 1.0,
};
