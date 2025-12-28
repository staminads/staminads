export interface GeoProfile {
  region: string;
  timezone: string;
  language: string;
  durationMultiplier: number;
  weight: number;
}

export const GEO_PROFILES: GeoProfile[] = [
  {
    region: 'US East',
    timezone: 'America/New_York',
    language: 'en-US',
    durationMultiplier: 1.0,
    weight: 25,
  },
  {
    region: 'US West',
    timezone: 'America/Los_Angeles',
    language: 'en-US',
    durationMultiplier: 1.0,
    weight: 15,
  },
  {
    region: 'UK',
    timezone: 'Europe/London',
    language: 'en-GB',
    durationMultiplier: 1.1,
    weight: 10,
  },
  {
    region: 'Germany',
    timezone: 'Europe/Berlin',
    language: 'de-DE',
    durationMultiplier: 1.3,
    weight: 8,
  },
  {
    region: 'France',
    timezone: 'Europe/Paris',
    language: 'fr-FR',
    durationMultiplier: 1.2,
    weight: 7,
  },
  {
    region: 'Japan',
    timezone: 'Asia/Tokyo',
    language: 'ja-JP',
    durationMultiplier: 1.5, // Highest engagement
    weight: 7,
  },
  {
    region: 'China',
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    durationMultiplier: 1.1,
    weight: 6,
  },
  {
    region: 'Australia',
    timezone: 'Australia/Sydney',
    language: 'en-AU',
    durationMultiplier: 1.15,
    weight: 5,
  },
  {
    region: 'Canada',
    timezone: 'America/Toronto',
    language: 'en-CA',
    durationMultiplier: 1.05,
    weight: 4,
  },
  {
    region: 'Spain',
    timezone: 'Europe/Madrid',
    language: 'es-ES',
    durationMultiplier: 1.1,
    weight: 4,
  },
  {
    region: 'Brazil',
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
    durationMultiplier: 0.8,
    weight: 3,
  },
  {
    region: 'India',
    timezone: 'Asia/Kolkata',
    language: 'en-IN',
    durationMultiplier: 0.7, // Lower engagement
    weight: 3,
  },
  {
    region: 'South Korea',
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
