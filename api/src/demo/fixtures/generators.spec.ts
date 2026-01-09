import {
  generateEvents,
  generateEventsByDay,
  getCachedFilters,
  clearFilterCache,
  GenerationConfig,
  DayBatch,
} from './generators';

describe('generators', () => {
  const baseConfig: GenerationConfig = {
    workspaceId: 'test-ws',
    sessionCount: 100,
    endDate: new Date('2025-01-15'),
    daysRange: 7,
  };

  beforeEach(() => {
    // Clear cache before each test
    clearFilterCache();
  });

  describe('getCachedFilters', () => {
    it('returns filters and version', () => {
      const result = getCachedFilters();

      expect(result.filters).toBeDefined();
      expect(Array.isArray(result.filters)).toBe(true);
      expect(result.version).toBeDefined();
      expect(typeof result.version).toBe('string');
    });

    it('returns same result on subsequent calls (caching)', () => {
      const result1 = getCachedFilters();
      const result2 = getCachedFilters();

      expect(result1.filters).toBe(result2.filters);
      expect(result1.version).toBe(result2.version);
    });
  });

  describe('clearFilterCache', () => {
    it('clears the cached filters', () => {
      const result1 = getCachedFilters();
      clearFilterCache();
      const result2 = getCachedFilters();

      // Filters should be regenerated (different array reference)
      expect(result1.filters).not.toBe(result2.filters);
    });
  });

  describe('generateEvents', () => {
    it('generates events for the specified session count', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 10,
        daysRange: 3,
      });

      // Each session generates 1-4 events, so total should be >= sessionCount
      expect(events.length).toBeGreaterThanOrEqual(10);
    });

    it('generates events with required fields', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 5,
        daysRange: 2,
      });

      const event = events[0];

      // Check required fields
      expect(event.session_id).toBeDefined();
      expect(event.workspace_id).toBe('test-ws');
      expect(event.name).toBeDefined();
      expect(event.created_at).toBeDefined();
      expect(event.path).toBeDefined();
    });

    it('generates events with valid event names', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 20,
        daysRange: 3,
      });

      const validEventNames = ['screen_view', 'scroll', 'goal'];
      for (const event of events) {
        expect(validEventNames).toContain(event.name);
      }
    });

    it('generates events within the date range', () => {
      const endDate = new Date('2025-01-15');
      const events = generateEvents({
        ...baseConfig,
        endDate,
        daysRange: 7,
        sessionCount: 50,
      });

      const startDate = new Date('2025-01-08');

      for (const event of events) {
        const eventDate = new Date(event.created_at.replace(' ', 'T') + 'Z');
        // Add 1-day buffer on each side for timezone handling
        expect(eventDate.getTime()).toBeGreaterThanOrEqual(
          startDate.getTime() - 86400000,
        );
        expect(eventDate.getTime()).toBeLessThanOrEqual(
          endDate.getTime() + 86400000,
        );
      }
    });

    it('generates unique session IDs', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 50,
        daysRange: 5,
      });

      const sessionIds = new Set(events.map((e) => e.session_id));
      // Number of unique sessions should match expected count
      expect(sessionIds.size).toBe(50);
    });

    it('includes landing page information', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 10,
        daysRange: 2,
      });

      for (const event of events) {
        expect(event.landing_page).toContain('https://www.apple.com');
        expect(event.landing_domain).toBe('www.apple.com');
        expect(event.landing_path).toMatch(/^\//);
      }
    });

    it('includes device information', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 10,
        daysRange: 2,
      });

      for (const event of events) {
        expect(event.browser).toBeDefined();
        expect(event.os).toBeDefined();
        expect(event.device).toBeDefined();
        expect(event.screen_width).toBeGreaterThan(0);
        expect(event.screen_height).toBeGreaterThan(0);
      }
    });

    it('includes geo information', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 10,
        daysRange: 2,
      });

      for (const event of events) {
        expect(event.country).toBeDefined();
        expect(event.language).toBeDefined();
        expect(event.timezone).toBeDefined();
      }
    });

    it('generates scroll events with max_scroll values', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 100,
        daysRange: 5,
      });

      const scrollEvents = events.filter((e) => e.name === 'scroll');

      for (const event of scrollEvents) {
        expect(event.max_scroll).toBeGreaterThanOrEqual(0);
        expect(event.max_scroll).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('generateEventsByDay', () => {
    it('yields day batches as a generator', () => {
      const generator = generateEventsByDay({
        ...baseConfig,
        sessionCount: 30,
        daysRange: 3,
      });

      const batches: DayBatch[] = [];
      for (const batch of generator) {
        batches.push(batch);
      }

      // daysRange: 3 means we go back 3 days from endDate, generating 4 days total (inclusive)
      expect(batches.length).toBe(4);
    });

    it('each batch contains date, events, and sessionCount', () => {
      const generator = generateEventsByDay({
        ...baseConfig,
        sessionCount: 20,
        daysRange: 2,
      });

      for (const batch of generator) {
        expect(batch.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Array.isArray(batch.events)).toBe(true);
        expect(typeof batch.sessionCount).toBe('number');
        expect(batch.sessionCount).toBeGreaterThan(0);
      }
    });

    it('total session count across batches equals config', () => {
      const generator = generateEventsByDay({
        ...baseConfig,
        sessionCount: 100,
        daysRange: 5,
      });

      let totalSessions = 0;
      for (const batch of generator) {
        totalSessions += batch.sessionCount;
      }

      expect(totalSessions).toBe(100);
    });

    it('dates are in chronological order', () => {
      const generator = generateEventsByDay({
        ...baseConfig,
        sessionCount: 50,
        daysRange: 5,
      });

      const dates: string[] = [];
      for (const batch of generator) {
        dates.push(batch.date);
      }

      const sortedDates = [...dates].sort();
      expect(dates).toEqual(sortedDates);
    });

    it('applies iPhone launch traffic boost', () => {
      // End date is 2025-01-15, launch date is 2 weeks before = 2025-01-01
      const generator = generateEventsByDay({
        workspaceId: 'test-ws',
        sessionCount: 1000,
        endDate: new Date('2025-01-15'),
        daysRange: 21, // 3 weeks to capture launch period
      });

      const batches: DayBatch[] = [];
      for (const batch of generator) {
        batches.push(batch);
      }

      // Launch day (2025-01-01) should have higher session count than a normal day
      const launchDayBatch = batches.find((b) => b.date === '2025-01-01');
      const normalDayBatch = batches.find((b) => b.date === '2024-12-28');

      if (launchDayBatch && normalDayBatch) {
        // Launch day should have significantly more sessions (3x multiplier)
        expect(launchDayBatch.sessionCount).toBeGreaterThan(
          normalDayBatch.sessionCount,
        );
      }
    });
  });

  describe('session event structure', () => {
    it('first event in session is always screen_view', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 20,
        daysRange: 3,
      });

      // Group events by session
      const sessionEvents = new Map<string, typeof events>();
      for (const event of events) {
        const sessionId = event.session_id;
        if (!sessionEvents.has(sessionId)) {
          sessionEvents.set(sessionId, []);
        }
        sessionEvents.get(sessionId)!.push(event);
      }

      // Check first event of each session
      for (const [, sessionEventList] of sessionEvents) {
        // Sort by created_at
        sessionEventList.sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
        expect(sessionEventList[0].name).toBe('screen_view');
      }
    });

    it('includes SDK version on all events', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 10,
        daysRange: 2,
      });

      for (const event of events) {
        expect(event.sdk_version).toBe('1.2.0');
      }
    });

    it('populates channel and channel_group from filters', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 50,
        daysRange: 3,
      });

      // Some events should have channel values (based on filter matching)
      const eventsWithChannel = events.filter((e) => e.channel !== '');
      expect(eventsWithChannel.length).toBeGreaterThan(0);
    });
  });

  describe('UTM parameters', () => {
    it('generates events with and without UTM params', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 200,
        daysRange: 5,
      });

      const withUtm = events.filter((e) => e.utm_source !== '');
      const withoutUtm = events.filter((e) => e.utm_source === '');

      // Both should exist (most traffic has no UTM)
      expect(withoutUtm.length).toBeGreaterThan(0);
      // Some should have UTM
      expect(withUtm.length).toBeGreaterThan(0);
    });
  });

  describe('referrer data', () => {
    it('generates direct and referred traffic', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 200,
        daysRange: 5,
      });

      const directTraffic = events.filter((e) => e.is_direct === true);
      const referredTraffic = events.filter((e) => e.is_direct === false);

      expect(directTraffic.length).toBeGreaterThan(0);
      expect(referredTraffic.length).toBeGreaterThan(0);
    });

    it('referred traffic has valid referrer URL', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 200,
        daysRange: 5,
      });

      const referredEvents = events.filter((e) => e.is_direct === false);

      for (const event of referredEvents.slice(0, 20)) {
        expect(event.referrer).toMatch(/^https:\/\//);
        expect(event.referrer_domain).toBeTruthy();
      }
    });
  });

  describe('goal events', () => {
    it('generates goal events for some sessions', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 500,
        daysRange: 7,
      });

      const goalEvents = events.filter((e) => e.name === 'goal');
      expect(goalEvents.length).toBeGreaterThan(0);
    });

    it('maintains funnel integrity', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 1000,
        daysRange: 14,
      });

      // Group goals by session
      const sessionGoals = new Map<string, string[]>();
      for (const event of events.filter((e) => e.name === 'goal')) {
        const goals = sessionGoals.get(event.session_id) || [];
        goals.push(event.goal_name);
        sessionGoals.set(event.session_id, goals);
      }

      // Verify funnel integrity: purchase requires checkout_start, checkout_start requires add_to_cart
      for (const [, goals] of sessionGoals) {
        if (goals.includes('purchase')) {
          expect(goals).toContain('checkout_start');
          expect(goals).toContain('add_to_cart');
        }
        if (goals.includes('checkout_start')) {
          expect(goals).toContain('add_to_cart');
        }
      }
    });

    it('goal values are within product price ranges', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 500,
        daysRange: 7,
      });

      const addToCartEvents = events.filter(
        (e) => e.name === 'goal' && e.goal_name === 'add_to_cart',
      );

      for (const goal of addToCartEvents) {
        // All Apple product prices are between $99 and $6999
        expect(goal.goal_value).toBeGreaterThanOrEqual(99);
        expect(goal.goal_value).toBeLessThanOrEqual(6999);
      }
    });

    it('includes product slug in properties', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 500,
        daysRange: 7,
      });

      const goalEvents = events.filter((e) => e.name === 'goal');

      for (const goal of goalEvents) {
        expect(goal.properties?.product).toBeDefined();
        expect(goal.properties?.product).not.toBe('');
      }
    });

    it('checkout_start has zero goal_value', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 500,
        daysRange: 7,
      });

      const checkoutEvents = events.filter(
        (e) => e.name === 'goal' && e.goal_name === 'checkout_start',
      );

      for (const event of checkoutEvents) {
        expect(event.goal_value).toBe(0);
      }
    });

    it('purchase and add_to_cart have same goal_value in same session', () => {
      const events = generateEvents({
        ...baseConfig,
        sessionCount: 1000,
        daysRange: 14,
      });

      // Group goal events by session
      const sessionGoalEvents = new Map<
        string,
        { name: string; value: number }[]
      >();
      for (const event of events.filter((e) => e.name === 'goal')) {
        const goals = sessionGoalEvents.get(event.session_id) || [];
        goals.push({ name: event.goal_name, value: event.goal_value });
        sessionGoalEvents.set(event.session_id, goals);
      }

      // Find sessions with both add_to_cart and purchase
      for (const [, goals] of sessionGoalEvents) {
        const addToCart = goals.find((g) => g.name === 'add_to_cart');
        const purchase = goals.find((g) => g.name === 'purchase');

        if (addToCart && purchase) {
          expect(purchase.value).toBe(addToCart.value);
        }
      }
    });
  });
});
