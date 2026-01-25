import { randomUUID } from 'crypto';
import {
  APPLE_PAGES,
  APPLE_PAGES_TOTAL_WEIGHT,
  IPHONE_LAUNCH_PAGES,
  IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT,
  ApplePage,
  getProductPrice,
  generateRandomPrice,
} from './apple-pages';
import {
  REFERRERS,
  REFERRERS_TOTAL_WEIGHT,
  TECH_NEWS_REFERRERS,
  TECH_NEWS_TOTAL_WEIGHT,
  Referrer,
} from './referrers';
import {
  DEVICE_PROFILES,
  DEVICE_PROFILES_TOTAL_WEIGHT,
  DeviceProfile,
} from './devices';
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
import { FilterDefinition } from '../../filters/entities/filter.entity';
import {
  evaluateFilters,
  computeFilterVersion,
} from '../../filters/lib/filter-evaluator';
import { getDemoFilters } from './demo-filters';
import { toClickHouseDateTime } from '../../common/utils/datetime.util';
import { APP_VERSION } from '../../version';

// Base session duration categories (in seconds)
const DURATION_CATEGORIES = [
  { min: 5, max: 15, weight: 30 }, // Bounce
  { min: 30, max: 180, weight: 40 }, // Engaged
  { min: 180, max: 600, weight: 20 }, // Deep
  { min: 600, max: 1800, weight: 10 }, // Power users
];

// Goal conversion configuration
const GOAL_CONFIG = {
  addToCartRate: 0.04, // 4% of eligible sessions
  checkoutFromCartRate: 0.4, // 40% of add_to_cart proceed to checkout
  purchaseFromCheckoutRate: 0.5, // 50% of checkout complete purchase
  launchMultiplier: 1.5, // Higher conversion during launch
  postLaunchMultiplier: 1.2,
  minDurationForGoal: 30, // Minimum session duration (seconds)
  minScrollForGoal: 20, // Minimum scroll depth %
};

interface GoalDecision {
  hasAddToCart: boolean;
  hasCheckoutStart: boolean;
  hasPurchase: boolean;
  productSlug: string | null;
  goalValue: number;
}

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

// SDK version - use current app version
const SDK_VERSION = APP_VERSION;

// Cache filters to avoid regenerating for each session
let _cachedFilters: FilterDefinition[] | null = null;
let _cachedFilterVersion: string | null = null;

/**
 * Get cached demo filters. This ensures the same filter IDs are used
 * for both session generation and workspace creation.
 */
export function getCachedFilters(): {
  filters: FilterDefinition[];
  version: string;
} {
  if (!_cachedFilters) {
    _cachedFilters = getDemoFilters();
    _cachedFilterVersion = computeFilterVersion(_cachedFilters);
  }
  return { filters: _cachedFilters, version: _cachedFilterVersion! };
}

/**
 * Clear the filter cache. Used when regenerating demo data to ensure
 * fresh filter IDs are generated.
 */
export function clearFilterCache(): void {
  _cachedFilters = null;
  _cachedFilterVersion = null;
}

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

// Decide which goals a session should have
function decideGoals(
  page: ApplePage,
  duration: number,
  maxScroll: number,
  launchPeriod: 'launch' | 'post' | 'normal',
): GoalDecision {
  const result: GoalDecision = {
    hasAddToCart: false,
    hasCheckoutStart: false,
    hasPurchase: false,
    productSlug: null,
    goalValue: 0,
  };

  // Only product pages can trigger goals
  if (page.category !== 'product') return result;
  if (duration < GOAL_CONFIG.minDurationForGoal) return result;
  if (maxScroll < GOAL_CONFIG.minScrollForGoal) return result;

  const priceInfo = getProductPrice(page.path);
  if (!priceInfo) return result;

  // Calculate adjusted rate based on launch period
  let rateMultiplier = 1.0;
  if (launchPeriod === 'launch') rateMultiplier = GOAL_CONFIG.launchMultiplier;
  else if (launchPeriod === 'post')
    rateMultiplier = GOAL_CONFIG.postLaunchMultiplier;

  // Engagement bonus: longer sessions and deeper scrolls convert better
  const engagementBonus = Math.min(duration / 300, 1.0);
  const scrollBonus = maxScroll / 100;
  const sessionMultiplier = 1 + engagementBonus * 0.5 + scrollBonus * 0.3;

  const addToCartRate =
    GOAL_CONFIG.addToCartRate * rateMultiplier * sessionMultiplier;

  if (Math.random() < addToCartRate) {
    result.hasAddToCart = true;
    result.productSlug = priceInfo.productSlug;
    result.goalValue = generateRandomPrice(priceInfo);

    if (Math.random() < GOAL_CONFIG.checkoutFromCartRate) {
      result.hasCheckoutStart = true;
      if (Math.random() < GOAL_CONFIG.purchaseFromCheckoutRate) {
        result.hasPurchase = true;
      }
    }
  }

  return result;
}

// Connection type distribution (null for ~30% to simulate Safari/Firefox)
function generateConnectionType(): string | null {
  const random = Math.random();

  // 30% null (Safari/Firefox don't support Network Information API)
  if (random < 0.3) {
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
function generateViewport(
  screenWidth: number,
  screenHeight: number,
): { width: number; height: number } {
  // Viewport is typically 90-100% of screen width (scrollbar, etc.)
  const widthRatio = 0.9 + Math.random() * 0.1;
  // Viewport height is 75-95% of screen (browser chrome, toolbars)
  const heightRatio = 0.75 + Math.random() * 0.2;

  return {
    width: Math.round(screenWidth * widthRatio),
    height: Math.round(screenHeight * heightRatio),
  };
}

// Keynote hour in workspace timezone (America/New_York)
// 10am Pacific = 1pm Eastern = 13:00
const KEYNOTE_HOUR_EASTERN = 13;

function isIPhoneLaunchPeriod(
  date: Date,
  launchDate: Date,
  hour: number,
): 'launch' | 'post' | 'normal' {
  const diff = date.getTime() - launchDate.getTime();
  const daysDiff = diff / (1000 * 60 * 60 * 24);

  if (daysDiff >= 0 && daysDiff < 1) {
    // Launch day: only spike after keynote starts (1pm Eastern = 10am Pacific)
    if (hour >= KEYNOTE_HOUR_EASTERN) {
      return 'launch'; // 5x traffic after keynote
    }
    return 'normal'; // Normal traffic before keynote
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

export interface DayBatch {
  date: string;
  events: TrackingEvent[];
  sessionCount: number;
}

export function generateEvents(config: GenerationConfig): TrackingEvent[] {
  const { workspaceId, sessionCount, endDate, daysRange } = config;
  const allEvents: TrackingEvent[] = [];

  // Calculate date range
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - daysRange);

  // iPhone launch date: 5 days before end date (positions spike in "current" period)
  const launchDate = new Date(endDate);
  launchDate.setDate(launchDate.getDate() - 5);

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

    for (let i = 0; i < count; i++) {
      const sessionEvents = generateSessionEvents(
        workspaceId,
        dayDate,
        launchDate,
        sessionIndex,
      );
      allEvents.push(...sessionEvents);
      sessionIndex++;
    }
  }

  return allEvents;
}

/**
 * Generator version of generateEvents that yields day-by-day batches.
 * This allows streaming insertion without loading all events in memory.
 */
export function* generateEventsByDay(
  config: GenerationConfig,
): Generator<DayBatch> {
  const { workspaceId, sessionCount, endDate, daysRange } = config;

  // Calculate date range
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - daysRange);

  // iPhone launch date: 5 days before end date (positions spike in "current" period)
  const launchDate = new Date(endDate);
  launchDate.setDate(launchDate.getDate() - 5);

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
    const dayEvents: TrackingEvent[] = [];

    for (let i = 0; i < count; i++) {
      const sessionEvents = generateSessionEvents(
        workspaceId,
        dayDate,
        launchDate,
        sessionIndex,
      );
      dayEvents.push(...sessionEvents);
      sessionIndex++;
    }

    yield {
      date: dateKey,
      events: dayEvents,
      sessionCount: count,
    };
  }
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

  // Calculate total days for growth trend
  const daysTotal = Math.floor(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Calculate weight for each day
  const current = new Date(startDate);
  while (current <= endDate) {
    const dateKey = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    let weight = DAY_OF_WEEK_WEIGHTS[dayOfWeek] || 1;

    // Growth trend: starts at 0.85x, ends at 1.15x over the period
    const dayIndex = Math.floor(
      (current.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const growthMultiplier = 0.85 + (dayIndex / daysTotal) * 0.3;
    weight *= growthMultiplier;

    // Apply launch multipliers (daily average)
    // For launch day: use 2.5x as average (normal morning + 5x afternoon)
    // Per-session launch behavior is determined by hour in generateSessionEvents
    const diff = current.getTime() - launchDate.getTime();
    const daysDiff = diff / (1000 * 60 * 60 * 24);
    if (daysDiff >= 0 && daysDiff < 1) {
      weight *= 2.5; // Launch day average (morning normal, afternoon 5x)
    } else if (daysDiff >= 1 && daysDiff < 4) {
      weight *= 1.5; // Post-launch
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
  launchDate: Date,
  sessionIndex: number,
): TrackingEvent[] {
  const events: TrackingEvent[] = [];

  // Generate session ID
  const sessionId = `demo-${sessionIndex.toString().padStart(6, '0')}-${randomUUID().slice(0, 8)}`;

  // Select geo profile first (affects timezone for hour calculation)
  const geo = weightedRandom(GEO_PROFILES, GEO_PROFILES_TOTAL_WEIGHT);

  // Generate random hour with distribution
  const hour = generateHour();

  // Determine launch period based on actual hour
  const launchPeriod = isIPhoneLaunchPeriod(dayDate, launchDate, hour);

  // Create timestamp
  const sessionStart = new Date(dayDate);
  sessionStart.setHours(
    hour,
    randomBetween(0, 59),
    randomBetween(0, 59),
    randomBetween(0, 999),
  );

  // Select components based on launch period
  const page = selectPage(launchPeriod);
  const device = weightedRandom(DEVICE_PROFILES, DEVICE_PROFILES_TOTAL_WEIGHT);
  const utm = selectUtm(launchPeriod);

  // Determine referrer based on UTM source (paid traffic uses ad network as referrer)
  const referrer = selectReferrerForUtm(utm, launchPeriod);

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

  // Build field values for filter rule evaluation
  const fieldValues: Record<string, string | null | undefined> = {
    utm_source: utm?.source ?? null,
    utm_medium: utm?.medium ?? null,
    utm_campaign: utm?.campaign ?? null,
    utm_term: utm?.term ?? null,
    utm_content: utm?.content ?? null,
    referrer_domain: referrer.domain,
    referrer_path: referrer.path ?? null,
    is_direct: isDirect ? 'true' : 'false',
    landing_page: landingPage,
    landing_domain: 'www.apple.com',
    landing_path: page.path,
  };

  // Compute custom dimension values using filters (channel, channel_group, stm_1 = Product Category)
  const { filters } = getCachedFilters();
  const cdValues = evaluateFilters(filters, fieldValues);

  // Base event properties (shared across all events in session)
  const baseProps: Omit<
    TrackingEvent,
    | 'received_at'
    | 'created_at'
    | 'updated_at'
    | 'name'
    | 'path'
    | 'duration'
    | 'page_duration'
    | 'previous_path'
    | 'max_scroll'
    // V3 per-event fields (set when creating each event)
    | 'entered_at'
    | 'exited_at'
    | 'goal_timestamp'
    | 'page_number'
    | 'dedup_token'
    | '_version'
    | 'goal_name'
    | 'goal_value'
  > = {
    session_id: sessionId,
    workspace_id: workspaceId,
    referrer: referrerUrl ?? '',
    referrer_domain: referrer.domain ?? '',
    referrer_path: referrerPath ?? '',
    is_direct: isDirect,
    landing_page: landingPage,
    landing_domain: 'www.apple.com',
    landing_path: page.path,
    utm_source: utm?.source ?? '',
    utm_medium: utm?.medium ?? '',
    utm_campaign: utm?.campaign ?? '',
    utm_term: utm?.term ?? '',
    utm_content: utm?.content ?? '',
    utm_id: '',
    utm_id_from: '',
    // Channel classification (computed from demo filters)
    channel: (cdValues.channel as string) ?? '',
    channel_group: (cdValues.channel_group as string) ?? '',
    // Custom dimensions (stm_1 = Product Category; stm_2-stm_10 available for user use)
    stm_1: (cdValues.stm_1 as string) ?? '', // Product Category
    stm_2: '',
    stm_3: '',
    stm_4: '',
    stm_5: '',
    stm_6: '',
    stm_7: '',
    stm_8: '',
    stm_9: '',
    stm_10: '',
    screen_width: device.screenWidth,
    screen_height: device.screenHeight,
    viewport_width: viewport.width,
    viewport_height: viewport.height,
    user_agent: device.userAgent,
    language: geo.language,
    timezone: geo.timezone,
    // Geo location (demo fixtures use random geo data)
    country: geo.country ?? '',
    region: geo.region ?? '',
    city: geo.city ?? '',
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    browser: device.browser,
    browser_type: device.browserType ?? '',
    os: device.os,
    device: device.device,
    connection_type: generateConnectionType() ?? '',
    sdk_version: SDK_VERSION,
    user_id: null,
  };

  // Event 1: screen_view (landing page)
  // Session start timestamp (SDK session creation time)
  const sessionCreatedAt = toClickHouseDateTime(sessionStart);
  const version = Date.now();

  // SDK sends cumulative focus duration with each event in milliseconds
  // duration variable = total session duration in seconds (converted to ms when stored)
  events.push({
    ...baseProps,
    received_at: toClickHouseDateTime(sessionStart), // Server timestamp
    created_at: sessionCreatedAt, // SDK session start
    updated_at: toClickHouseDateTime(sessionStart), // SDK interaction time
    name: 'screen_view',
    path: page.path,
    duration: 0, // First event has 0 duration
    page_duration: 0, // v3: no previous page yet
    previous_path: '', // v3: no previous path for landing
    max_scroll: 0,
    // V3 required fields
    page_number: 1,
    dedup_token: `${sessionId}_pv_1`,
    _version: version,
    goal_name: '',
    goal_value: 0,
    entered_at: toClickHouseDateTime(sessionStart),
    exited_at: toClickHouseDateTime(sessionStart),
    goal_timestamp: null,
  });

  // Event 2: scroll (50% chance, happens after some time)
  if (Math.random() < 0.5 && duration > 10) {
    const scrollTime = new Date(sessionStart.getTime() + duration * 300); // 30% into session
    const elapsedSeconds = Math.round(duration * 0.3);
    events.push({
      ...baseProps,
      received_at: toClickHouseDateTime(scrollTime),
      created_at: sessionCreatedAt,
      updated_at: toClickHouseDateTime(scrollTime),
      name: 'scroll',
      path: page.path,
      duration: elapsedSeconds * 1000, // Cumulative duration at this point (ms)
      page_duration: 0, // v3: scroll events don't carry page duration
      previous_path: '', // v3: scroll events don't carry previous path
      max_scroll: generateMaxScroll(duration),
      // V3 required fields
      page_number: 1,
      dedup_token: `${sessionId}_scroll_1`,
      _version: version,
      goal_name: '',
      goal_value: 0,
      entered_at: toClickHouseDateTime(scrollTime),
      exited_at: toClickHouseDateTime(scrollTime),
      goal_timestamp: null,
    });
  }

  // Event 3: additional screen_view (30% chance for multi-page sessions)
  if (Math.random() < 0.3 && duration > 30) {
    const secondPage = selectPage(launchPeriod);
    const secondPageTime = new Date(sessionStart.getTime() + duration * 500); // 50% into session
    const elapsedSeconds = Math.round(duration * 0.5);
    const firstPageDuration = Math.round(duration * 0.5); // Time spent on first page
    const firstPageExitTime = new Date(
      sessionStart.getTime() + firstPageDuration * 1000,
    );
    events.push({
      ...baseProps,
      received_at: toClickHouseDateTime(secondPageTime),
      created_at: sessionCreatedAt,
      updated_at: toClickHouseDateTime(secondPageTime),
      name: 'screen_view',
      path: secondPage.path,
      duration: elapsedSeconds * 1000, // Cumulative duration at this point (ms)
      page_duration: firstPageDuration * 1000, // v3: time spent on previous page (ms)
      previous_path: page.path, // v3: previous page was landing page
      max_scroll: generateMaxScroll(duration / 2),
      // V3 required fields
      page_number: 2,
      dedup_token: `${sessionId}_pv_2`,
      _version: version,
      goal_name: '',
      goal_value: 0,
      entered_at: toClickHouseDateTime(firstPageExitTime),
      exited_at: toClickHouseDateTime(secondPageTime),
      goal_timestamp: null,
    });
  }

  // Final event: ensures session has proper duration by adding an event at the end
  if (duration >= 5) {
    const endTime = new Date(sessionStart.getTime() + duration * 1000);
    events.push({
      ...baseProps,
      received_at: toClickHouseDateTime(endTime),
      created_at: sessionCreatedAt,
      updated_at: toClickHouseDateTime(endTime),
      name: 'scroll',
      path: events[events.length - 1].path, // Same as last page
      duration: duration * 1000, // Final cumulative duration (full session, ms)
      page_duration: 0, // v3: scroll events don't carry page duration
      previous_path: '', // v3: scroll events don't carry previous path
      max_scroll: generateMaxScroll(duration),
      // V3 required fields
      page_number: events.filter((e) => e.name === 'screen_view').length,
      dedup_token: `${sessionId}_scroll_final`,
      _version: version,
      goal_name: '',
      goal_value: 0,
      entered_at: toClickHouseDateTime(endTime),
      exited_at: toClickHouseDateTime(endTime),
      goal_timestamp: null,
    });
  }

  // Goal events (e-commerce funnel)
  const maxScrollForGoals = generateMaxScroll(duration);
  const goals = decideGoals(page, duration, maxScrollForGoals, launchPeriod);

  if (goals.hasAddToCart && goals.productSlug) {
    // add_to_cart happens at 40-60% through session
    const addToCartTime = new Date(
      sessionStart.getTime() + duration * 1000 * (0.4 + Math.random() * 0.2),
    );
    const addToCartTs = addToCartTime.getTime();

    events.push({
      ...baseProps,
      received_at: toClickHouseDateTime(addToCartTime),
      created_at: sessionCreatedAt,
      updated_at: toClickHouseDateTime(addToCartTime),
      name: 'goal',
      path: page.path,
      duration: 0,
      page_duration: 0,
      previous_path: '',
      max_scroll: 0,
      page_number: events.filter((e) => e.name === 'screen_view').length,
      dedup_token: `${sessionId}_goal_add_to_cart_${addToCartTs}`,
      _version: version,
      goal_name: 'add_to_cart',
      goal_value: goals.goalValue,
      entered_at: toClickHouseDateTime(addToCartTime),
      exited_at: toClickHouseDateTime(addToCartTime),
      goal_timestamp: toClickHouseDateTime(addToCartTime),
      properties: { product: goals.productSlug },
    });

    if (goals.hasCheckoutStart) {
      // checkout_start happens 5-15 seconds after add_to_cart
      const checkoutTime = new Date(addToCartTs + 5000 + Math.random() * 10000);
      const checkoutTs = checkoutTime.getTime();

      events.push({
        ...baseProps,
        received_at: toClickHouseDateTime(checkoutTime),
        created_at: sessionCreatedAt,
        updated_at: toClickHouseDateTime(checkoutTime),
        name: 'goal',
        path: page.path,
        duration: 0,
        page_duration: 0,
        previous_path: '',
        max_scroll: 0,
        page_number: events.filter((e) => e.name === 'screen_view').length,
        dedup_token: `${sessionId}_goal_checkout_start_${checkoutTs}`,
        _version: version,
        goal_name: 'checkout_start',
        goal_value: 0,
        entered_at: toClickHouseDateTime(checkoutTime),
        exited_at: toClickHouseDateTime(checkoutTime),
        goal_timestamp: toClickHouseDateTime(checkoutTime),
        properties: { product: goals.productSlug },
      });

      if (goals.hasPurchase) {
        // purchase happens 30-120 seconds after checkout_start
        const purchaseTime = new Date(
          checkoutTs + 30000 + Math.random() * 90000,
        );
        const purchaseTs = purchaseTime.getTime();

        events.push({
          ...baseProps,
          received_at: toClickHouseDateTime(purchaseTime),
          created_at: sessionCreatedAt,
          updated_at: toClickHouseDateTime(purchaseTime),
          name: 'goal',
          path: page.path,
          duration: 0,
          page_duration: 0,
          previous_path: '',
          max_scroll: 0,
          page_number: events.filter((e) => e.name === 'screen_view').length,
          dedup_token: `${sessionId}_goal_purchase_${purchaseTs}`,
          _version: version,
          goal_name: 'purchase',
          goal_value: goals.goalValue,
          entered_at: toClickHouseDateTime(purchaseTime),
          exited_at: toClickHouseDateTime(purchaseTime),
          goal_timestamp: toClickHouseDateTime(purchaseTime),
          properties: { product: goals.productSlug },
        });
      }
    }
  }

  return events;
}

function generateHour(): number {
  // Weight hours by traffic patterns
  const hourWeights = Object.entries(HOUR_MULTIPLIERS).map(
    ([hour, weight]) => ({
      hour: parseInt(hour),
      weight: weight * 10, // Scale up for better distribution
    }),
  );
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
      return weightedRandom(
        IPHONE_LAUNCH_PAGES,
        IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT,
      );
    }
  } else if (launchPeriod === 'post') {
    // 50% chance of iPhone launch pages
    if (Math.random() < 0.5) {
      return weightedRandom(
        IPHONE_LAUNCH_PAGES,
        IPHONE_LAUNCH_PAGES_TOTAL_WEIGHT,
      );
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

/**
 * Map UTM sources to their corresponding referrer domains.
 * Paid traffic should have the ad network as referrer.
 * Email traffic has no referrer (email clients don't pass referrer).
 */
const UTM_SOURCE_TO_REFERRER: Record<string, Referrer> = {
  google: {
    domain: 'google.com',
    path: '/search',
    category: 'search',
    channelGroup: 'Paid Search',
    durationMultiplier: 1.2,
    weight: 1,
  },
  facebook: {
    domain: 'facebook.com',
    category: 'social',
    channelGroup: 'Paid Social',
    durationMultiplier: 0.8,
    weight: 1,
  },
  instagram: {
    domain: 'instagram.com',
    category: 'social',
    channelGroup: 'Paid Social',
    durationMultiplier: 0.7,
    weight: 1,
  },
  twitter: {
    domain: 'twitter.com',
    category: 'social',
    channelGroup: 'Social',
    durationMultiplier: 0.75,
    weight: 1,
  },
  display: {
    domain: null, // Display ads often don't have referrer
    category: 'direct',
    channelGroup: 'Display',
    durationMultiplier: 1.0,
    weight: 1,
  },
  affiliate: {
    domain: null, // Affiliates use direct links with UTM
    category: 'direct',
    channelGroup: 'Affiliate',
    durationMultiplier: 1.0,
    weight: 1,
  },
  email: {
    domain: null, // Email clients don't pass referrer
    category: 'direct',
    channelGroup: 'Email',
    durationMultiplier: 1.5,
    weight: 1,
  },
};

function selectReferrerForUtm(
  utm: UtmCampaign | null,
  launchPeriod: 'launch' | 'post' | 'normal',
): Referrer {
  // If UTM source has a mapped referrer, use it
  if (utm?.source && UTM_SOURCE_TO_REFERRER[utm.source]) {
    return UTM_SOURCE_TO_REFERRER[utm.source];
  }

  // No UTM or unmapped source: use random referrer selection
  return selectReferrer(launchPeriod);
}

function selectUtm(
  launchPeriod: 'launch' | 'post' | 'normal',
): UtmCampaign | null {
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
      return weightedRandom(
        IPHONE_LAUNCH_CAMPAIGNS,
        IPHONE_LAUNCH_CAMPAIGNS_TOTAL_WEIGHT,
      );
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
