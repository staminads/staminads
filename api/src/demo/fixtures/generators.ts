import { randomUUID } from 'crypto';
import {
  APPLE_PAGES,
  APPLE_PAGES_TOTAL_WEIGHT,
  IPHONE_LAUNCH_PAGES,
  IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT,
  ApplePage,
} from './apple-pages';
import {
  REFERRERS,
  REFERRERS_TOTAL_WEIGHT,
  TECH_NEWS_REFERRERS,
  TECH_NEWS_TOTAL_WEIGHT,
  Referrer,
} from './referrers';
import { DEVICE_PROFILES, DEVICE_PROFILES_TOTAL_WEIGHT, DeviceProfile } from './devices';
import {
  UTM_CAMPAIGNS,
  UTM_CAMPAIGNS_TOTAL_WEIGHT,
  IPHONE_LAUNCH_CAMPAIGNS,
  IPHONE_LAUNCH_CAMPAIGNS_TOTAL_WEIGHT,
  NO_UTM_WEIGHT,
  UtmCampaign,
} from './utm-campaigns';
import {
  GEO_PROFILES,
  GEO_PROFILES_TOTAL_WEIGHT,
  HOUR_MULTIPLIERS,
  DAY_OF_WEEK_WEIGHTS,
  GeoProfile,
} from './geo-languages';
import { TrackingEvent } from '../../events/entities/event.entity';

// Base session duration categories (in seconds)
const DURATION_CATEGORIES = [
  { min: 5, max: 15, weight: 30 }, // Bounce
  { min: 30, max: 180, weight: 40 }, // Engaged
  { min: 180, max: 600, weight: 20 }, // Deep
  { min: 600, max: 1800, weight: 10 }, // Power users
];

function weightedRandom<T extends { weight: number }>(
  items: T[],
  totalWeight: number,
): T {
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) {
      return item;
    }
  }
  return items[items.length - 1];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateBaseDuration(): number {
  const category = weightedRandom(DURATION_CATEGORIES, 100);
  return randomBetween(category.min, category.max);
}

function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

// SDK version - current version
const SDK_VERSION = '1.2.0';

// Max scroll distribution based on engagement
function generateMaxScroll(duration: number): number {
  // Longer sessions = deeper scroll
  if (duration < 15) {
    return randomBetween(5, 25); // Bounce: shallow scroll
  } else if (duration < 60) {
    return randomBetween(20, 50);
  } else if (duration < 180) {
    return randomBetween(40, 75);
  } else if (duration < 600) {
    return randomBetween(60, 90);
  } else {
    return randomBetween(80, 100); // Power users: full scroll
  }
}

// Connection type distribution (null for ~30% to simulate Safari/Firefox)
function generateConnectionType(): string | null {
  const random = Math.random();

  // 30% null (Safari/Firefox don't support Network Information API)
  if (random < 0.30) {
    return null;
  }

  // Remaining 70% distributed among connection types
  const connectionRandom = Math.random();
  if (connectionRandom < 0.85) {
    return '4g';
  } else if (connectionRandom < 0.95) {
    return '3g';
  } else if (connectionRandom < 0.98) {
    return '2g';
  } else {
    return 'slow-2g';
  }
}

// Generate viewport dimensions from screen dimensions
function generateViewport(screenWidth: number, screenHeight: number): { width: number; height: number } {
  // Viewport is typically 90-100% of screen width (scrollbar, etc.)
  const widthRatio = 0.90 + Math.random() * 0.10;
  // Viewport height is 75-95% of screen (browser chrome, toolbars)
  const heightRatio = 0.75 + Math.random() * 0.20;

  return {
    width: Math.round(screenWidth * widthRatio),
    height: Math.round(screenHeight * heightRatio),
  };
}

function isIPhoneLaunchPeriod(date: Date, launchDate: Date): 'launch' | 'post' | 'normal' {
  const diff = date.getTime() - launchDate.getTime();
  const daysDiff = diff / (1000 * 60 * 60 * 24);

  if (daysDiff >= 0 && daysDiff < 1) {
    return 'launch'; // Launch day: 3x traffic
  } else if (daysDiff >= 1 && daysDiff < 4) {
    return 'post'; // Post-launch: 2x traffic
  }
  return 'normal';
}

export interface GenerationConfig {
  workspaceId: string;
  sessionCount: number;
  endDate: Date;
  daysRange: number;
}

export function generateEvents(config: GenerationConfig): TrackingEvent[] {
  const { workspaceId, sessionCount, endDate, daysRange } = config;
  const allEvents: TrackingEvent[] = [];

  // Calculate date range
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - daysRange);

  // iPhone launch date: 2 weeks before end date
  const launchDate = new Date(endDate);
  launchDate.setDate(launchDate.getDate() - 14);

  // Pre-calculate daily session distribution
  const dailySessionCounts = calculateDailySessionCounts(
    startDate,
    endDate,
    launchDate,
    sessionCount,
  );

  let sessionIndex = 0;

  for (const [dateKey, count] of Object.entries(dailySessionCounts)) {
    const dayDate = new Date(dateKey);
    const launchPeriod = isIPhoneLaunchPeriod(dayDate, launchDate);

    for (let i = 0; i < count; i++) {
      const sessionEvents = generateSessionEvents(
        workspaceId,
        dayDate,
        launchPeriod,
        sessionIndex,
      );
      allEvents.push(...sessionEvents);
      sessionIndex++;
    }
  }

  return allEvents;
}

function calculateDailySessionCounts(
  startDate: Date,
  endDate: Date,
  launchDate: Date,
  totalSessions: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const weights: Record<string, number> = {};
  let totalWeight = 0;

  // Calculate weight for each day
  const current = new Date(startDate);
  while (current <= endDate) {
    const dateKey = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    let weight = DAY_OF_WEEK_WEIGHTS[dayOfWeek] || 1;

    // Apply launch multipliers
    const launchPeriod = isIPhoneLaunchPeriod(current, launchDate);
    if (launchPeriod === 'launch') {
      weight *= 3;
    } else if (launchPeriod === 'post') {
      weight *= 2;
    }

    weights[dateKey] = weight;
    totalWeight += weight;
    current.setDate(current.getDate() + 1);
  }

  // Distribute sessions proportionally
  let assignedSessions = 0;
  const dateKeys = Object.keys(weights);

  for (let i = 0; i < dateKeys.length; i++) {
    const dateKey = dateKeys[i];
    if (i === dateKeys.length - 1) {
      // Last day gets remaining sessions
      counts[dateKey] = totalSessions - assignedSessions;
    } else {
      const proportion = weights[dateKey] / totalWeight;
      const sessionCount = Math.round(totalSessions * proportion);
      counts[dateKey] = sessionCount;
      assignedSessions += sessionCount;
    }
  }

  return counts;
}

function generateSessionEvents(
  workspaceId: string,
  dayDate: Date,
  launchPeriod: 'launch' | 'post' | 'normal',
  sessionIndex: number,
): TrackingEvent[] {
  const events: TrackingEvent[] = [];

  // Generate session ID
  const sessionId = `demo-${sessionIndex.toString().padStart(6, '0')}-${randomUUID().slice(0, 8)}`;

  // Select geo profile first (affects timezone for hour calculation)
  const geo = weightedRandom(GEO_PROFILES, GEO_PROFILES_TOTAL_WEIGHT);

  // Generate random hour with distribution
  const hour = generateHour();

  // Create timestamp
  const sessionStart = new Date(dayDate);
  sessionStart.setHours(hour, randomBetween(0, 59), randomBetween(0, 59), randomBetween(0, 999));

  // Select components based on launch period
  const page = selectPage(launchPeriod);
  const referrer = selectReferrer(launchPeriod);
  const device = weightedRandom(DEVICE_PROFILES, DEVICE_PROFILES_TOTAL_WEIGHT);
  const utm = selectUtm(launchPeriod);

  // Calculate duration with all multipliers
  const baseDuration = generateBaseDuration();
  const duration = calculateFinalDuration(
    baseDuration,
    page,
    referrer,
    device,
    geo,
    utm,
    hour,
  );

  // Build landing page URL
  const landingPage = `https://www.apple.com${page.path}`;

  // Build referrer URL
  let referrerUrl: string | null = null;
  let referrerPath: string | null = null;
  if (referrer.domain) {
    referrerPath = referrer.path || '/';
    referrerUrl = `https://www.${referrer.domain}${referrerPath}`;
  }

  // Derive is_direct from referrer
  const isDirect = referrer.domain === null;

  // Generate viewport from screen dimensions
  const viewport = generateViewport(device.screenWidth, device.screenHeight);

  // Base event properties (shared across all events in session)
  const baseProps: Omit<TrackingEvent, 'created_at' | 'name' | 'path' | 'duration' | 'max_scroll'> = {
    session_id: sessionId,
    workspace_id: workspaceId,
    referrer: referrerUrl,
    referrer_domain: referrer.domain,
    referrer_path: referrerPath,
    is_direct: isDirect,
    landing_page: landingPage,
    landing_domain: 'www.apple.com',
    landing_path: page.path,
    utm_source: utm?.source ?? null,
    utm_medium: utm?.medium ?? null,
    utm_campaign: utm?.campaign ?? null,
    utm_term: utm?.term ?? null,
    utm_content: utm?.content ?? null,
    utm_id: null,
    utm_id_from: null,
    // Custom dimensions (computed at runtime from workspace definitions)
    cd_1: null,
    cd_2: null,
    cd_3: null,
    cd_4: null,
    cd_5: null,
    cd_6: null,
    cd_7: null,
    cd_8: null,
    cd_9: null,
    cd_10: null,
    filter_version: null,
    screen_width: device.screenWidth,
    screen_height: device.screenHeight,
    viewport_width: viewport.width,
    viewport_height: viewport.height,
    user_agent: device.userAgent,
    language: geo.language,
    timezone: geo.timezone,
    browser: device.browser,
    browser_type: device.browserType,
    os: device.os,
    device: device.device,
    connection_type: generateConnectionType(),
    sdk_version: SDK_VERSION,
  };

  // Event 1: screen_view (landing page)
  events.push({
    ...baseProps,
    created_at: toClickHouseDateTime(sessionStart),
    name: 'screen_view',
    path: page.path,
    duration: 0,
    max_scroll: null,
  });

  // Event 2: scroll (50% chance, happens after some time)
  if (Math.random() < 0.5 && duration > 10) {
    const scrollTime = new Date(sessionStart.getTime() + duration * 300); // 30% into session
    events.push({
      ...baseProps,
      created_at: toClickHouseDateTime(scrollTime),
      name: 'scroll',
      path: page.path,
      duration: 0,
      max_scroll: generateMaxScroll(duration),
    });
  }

  // Event 3: additional screen_view (30% chance for multi-page sessions)
  if (Math.random() < 0.3 && duration > 30) {
    const secondPage = selectPage(launchPeriod);
    const secondPageTime = new Date(sessionStart.getTime() + duration * 500); // 50% into session
    events.push({
      ...baseProps,
      created_at: toClickHouseDateTime(secondPageTime),
      name: 'screen_view',
      path: secondPage.path,
      duration: 0,
      max_scroll: generateMaxScroll(duration / 2),
    });
  }

  // Final event: ensures session has proper duration by adding an event at the end
  if (duration > 5) {
    const endTime = new Date(sessionStart.getTime() + duration * 1000);
    events.push({
      ...baseProps,
      created_at: toClickHouseDateTime(endTime),
      name: 'scroll',
      path: events[events.length - 1].path, // Same as last page
      duration: 0,
      max_scroll: generateMaxScroll(duration),
    });
  }

  return events;
}

function generateHour(): number {
  // Weight hours by traffic patterns
  const hourWeights = Object.entries(HOUR_MULTIPLIERS).map(([hour, weight]) => ({
    hour: parseInt(hour),
    weight: weight * 10, // Scale up for better distribution
  }));
  const totalWeight = hourWeights.reduce((sum, h) => sum + h.weight, 0);

  let random = Math.random() * totalWeight;
  for (const { hour, weight } of hourWeights) {
    random -= weight;
    if (random <= 0) {
      return hour;
    }
  }
  return 12; // Default to noon
}

function selectPage(launchPeriod: 'launch' | 'post' | 'normal'): ApplePage {
  // During launch, heavily favor iPhone pages
  if (launchPeriod === 'launch') {
    // 70% chance of iPhone launch pages
    if (Math.random() < 0.7) {
      return weightedRandom(IPHONE_LAUNCH_PAGES, IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT);
    }
  } else if (launchPeriod === 'post') {
    // 50% chance of iPhone launch pages
    if (Math.random() < 0.5) {
      return weightedRandom(IPHONE_LAUNCH_PAGES, IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT);
    }
  }

  return weightedRandom(APPLE_PAGES, APPLE_PAGES_TOTAL_WEIGHT);
}

function selectReferrer(launchPeriod: 'launch' | 'post' | 'normal'): Referrer {
  // During launch, increase tech news referrers
  if (launchPeriod === 'launch') {
    // 40% chance of tech news
    if (Math.random() < 0.4) {
      return weightedRandom(TECH_NEWS_REFERRERS, TECH_NEWS_TOTAL_WEIGHT);
    }
  } else if (launchPeriod === 'post') {
    // 25% chance of tech news
    if (Math.random() < 0.25) {
      return weightedRandom(TECH_NEWS_REFERRERS, TECH_NEWS_TOTAL_WEIGHT);
    }
  }

  return weightedRandom(REFERRERS, REFERRERS_TOTAL_WEIGHT);
}

function selectUtm(launchPeriod: 'launch' | 'post' | 'normal'): UtmCampaign | null {
  // Most traffic has no UTM parameters
  const totalWeight = UTM_CAMPAIGNS_TOTAL_WEIGHT + NO_UTM_WEIGHT;
  const random = Math.random() * totalWeight;

  if (random < NO_UTM_WEIGHT) {
    return null; // No UTM parameters
  }

  // During launch, favor iPhone launch campaigns
  if (launchPeriod === 'launch' || launchPeriod === 'post') {
    // 60% of UTM traffic uses iPhone launch campaigns
    if (Math.random() < 0.6) {
      return weightedRandom(IPHONE_LAUNCH_CAMPAIGNS, IPHONE_LAUNCH_CAMPAIGNS_TOTAL_WEIGHT);
    }
  }

  return weightedRandom(UTM_CAMPAIGNS, UTM_CAMPAIGNS_TOTAL_WEIGHT);
}

function calculateFinalDuration(
  baseDuration: number,
  page: ApplePage,
  referrer: Referrer,
  device: DeviceProfile,
  geo: GeoProfile,
  utm: UtmCampaign | null,
  hour: number,
): number {
  let multiplier = 1.0;

  // Apply all multipliers
  multiplier *= page.durationMultiplier;
  multiplier *= referrer.durationMultiplier;
  multiplier *= device.durationMultiplier;
  multiplier *= geo.durationMultiplier;
  multiplier *= HOUR_MULTIPLIERS[hour] || 1.0;

  if (utm) {
    multiplier *= utm.durationMultiplier;
  }

  // Apply multiplier with some randomness (±20%)
  const variance = 0.8 + Math.random() * 0.4;
  const finalDuration = Math.round(baseDuration * multiplier * variance);

  // Clamp to reasonable bounds
  return Math.max(1, Math.min(finalDuration, 3600));
}
