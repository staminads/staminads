export interface GeoProfile {
  country: string; // ISO 3166-1 alpha-2 code
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
  language: string;
  durationMultiplier: number;
  weight: number;
}

export const GEO_PROFILES: GeoProfile[] = [
  {
    country: 'US',
    region: 'New York',
    city: 'New York',
    latitude: 40.71,
    longitude: -74.01,
    timezone: 'America/New_York',
    language: 'en-US',
    durationMultiplier: 1.0,
    weight: 25,
  },
  {
    country: 'US',
    region: 'California',
    city: 'San Francisco',
    latitude: 37.77,
    longitude: -122.42,
    timezone: 'America/Los_Angeles',
    language: 'en-US',
    durationMultiplier: 1.0,
    weight: 15,
  },
  {
    country: 'GB',
    region: 'England',
    city: 'London',
    latitude: 51.51,
    longitude: -0.13,
    timezone: 'Europe/London',
    language: 'en-GB',
    durationMultiplier: 1.1,
    weight: 10,
  },
  {
    country: 'DE',
    region: 'Berlin',
    city: 'Berlin',
    latitude: 52.52,
    longitude: 13.41,
    timezone: 'Europe/Berlin',
    language: 'de-DE',
    durationMultiplier: 1.3,
    weight: 8,
  },
  {
    country: 'FR',
    region: 'Île-de-France',
    city: 'Paris',
    latitude: 48.86,
    longitude: 2.35,
    timezone: 'Europe/Paris',
    language: 'fr-FR',
    durationMultiplier: 1.2,
    weight: 7,
  },
  {
    country: 'JP',
    region: 'Tokyo',
    city: 'Tokyo',
    latitude: 35.68,
    longitude: 139.69,
    timezone: 'Asia/Tokyo',
    language: 'ja-JP',
    durationMultiplier: 1.5, // Highest engagement
    weight: 7,
  },
  {
    country: 'CN',
    region: 'Shanghai',
    city: 'Shanghai',
    latitude: 31.23,
    longitude: 121.47,
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    durationMultiplier: 1.1,
    weight: 6,
  },
  {
    country: 'AU',
    region: 'New South Wales',
    city: 'Sydney',
    latitude: -33.87,
    longitude: 151.21,
    timezone: 'Australia/Sydney',
    language: 'en-AU',
    durationMultiplier: 1.15,
    weight: 5,
  },
  {
    country: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    latitude: 43.65,
    longitude: -79.38,
    timezone: 'America/Toronto',
    language: 'en-CA',
    durationMultiplier: 1.05,
    weight: 4,
  },
  {
    country: 'ES',
    region: 'Community of Madrid',
    city: 'Madrid',
    latitude: 40.42,
    longitude: -3.70,
    timezone: 'Europe/Madrid',
    language: 'es-ES',
    durationMultiplier: 1.1,
    weight: 4,
  },
  {
    country: 'BR',
    region: 'São Paulo',
    city: 'São Paulo',
    latitude: -23.55,
    longitude: -46.63,
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
    durationMultiplier: 0.8,
    weight: 3,
  },
  {
    country: 'IN',
    region: 'Maharashtra',
    city: 'Mumbai',
    latitude: 19.08,
    longitude: 72.88,
    timezone: 'Asia/Kolkata',
    language: 'en-IN',
    durationMultiplier: 0.7, // Lower engagement
    weight: 3,
  },
  {
    country: 'KR',
    region: 'Seoul',
    city: 'Seoul',
    latitude: 37.57,
    longitude: 126.98,
    timezone: 'Asia/Seoul',
    language: 'ko-KR',
    durationMultiplier: 1.35,
    weight: 3,
  },
];

// Pre-compute total weight
export const GEO_PROFILES_TOTAL_WEIGHT = GEO_PROFILES.reduce(
  (sum, geo) => sum + geo.weight,
  0,
);

// Hour of day multipliers (applied based on local hour in the user's timezone)
export const HOUR_MULTIPLIERS: Record<number, number> = {
  0: 0.6, // 12am
  1: 0.55,
  2: 0.5,
  3: 0.45,
  4: 0.5,
  5: 0.6,
  6: 0.8,
  7: 0.9,
  8: 1.0,
  9: 1.2, // 9am peak
  10: 1.2,
  11: 1.1,
  12: 0.95, // lunch dip
  13: 0.9,
  14: 1.0, // 2pm
  15: 1.0,
  16: 1.05,
  17: 1.1,
  18: 1.15,
  19: 1.4, // 7pm peak
  20: 1.4,
  21: 1.3,
  22: 1.0,
  23: 0.8,
};

// Day of week traffic weights (for volume distribution, not duration)
export const DAY_OF_WEEK_WEIGHTS: Record<number, number> = {
  0: 0.6, // Sunday
  1: 1.0, // Monday
  2: 1.1, // Tuesday (highest)
  3: 1.05, // Wednesday
  4: 1.0, // Thursday
  5: 0.9, // Friday
  6: 0.7, // Saturday
};
