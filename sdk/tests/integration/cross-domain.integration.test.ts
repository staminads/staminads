/**
 * Cross-Domain Session Tracking Integration Tests
 *
 * Tests the full cross-domain flow including:
 * - Session continuity across domains (same visitor_id, session_id)
 * - URL decoration with _stm parameter
 * - Parameter reading and stripping
 * - Expired/invalid payload handling
 * - decorateUrl() API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrossDomainLinker, encode } from '../../src/core/cross-domain';
import { SessionManager } from '../../src/core/session';
import { Storage, TabStorage } from '../../src/storage/storage';
import type { InternalConfig } from '../../src/types';

describe('Cross-Domain Integration', () => {
  let storage: Storage;
  let tabStorage: TabStorage;
  let config: InternalConfig;
  let originalLocation: Location;
  let originalHistory: History;

  const createConfig = (overrides: Partial<InternalConfig> = {}): InternalConfig => ({
    workspace_id: 'ws_test',
    endpoint: 'https://api.example.com',
    debug: false,
    sessionTimeout: 30 * 60 * 1000,
    heartbeatInterval: 10000,
    adClickIds: ['gclid', 'fbclid'],
    trackSPA: true,
    trackScroll: true,
    trackClicks: false,
    heartbeatTiers: [{ after: 0, desktopInterval: 10000, mobileInterval: 7000 }],
    heartbeatMaxDuration: 10 * 60 * 1000,
    resetHeartbeatOnNavigation: false,
    crossDomains: ['blog.example.com', 'shop.example.com'],
    crossDomainExpiry: 120,
    crossDomainStripParams: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    storage = new Storage();
    tabStorage = new TabStorage();
    config = createConfig();

    // Store original location
    originalLocation = window.location;
    originalHistory = window.history;

    // Mock location
    const locationMock = {
      href: 'https://www.example.com/page',
      pathname: '/page',
      search: '',
      hash: '',
      origin: 'https://www.example.com',
      hostname: 'www.example.com',
    };
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
      configurable: true,
    });

    // Mock document.referrer
    Object.defineProperty(document, 'referrer', {
      value: '',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    // Restore location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  describe('Session Continuity', () => {
    it('should maintain same session when navigating to configured domain', () => {
      // Create session on source domain
      const sourceManager = new SessionManager(storage, tabStorage, config);
      const sourceSession = sourceManager.getOrCreateSession();

      // Create cross-domain linker
      const linker = new CrossDomainLinker({
        domains: config.crossDomains,
        expiry: config.crossDomainExpiry,
        debug: false,
      });
      linker.setIdGetters(
        () => sourceManager.getVisitorId(),
        () => sourceManager.getSessionId()
      );

      // Decorate URL for target domain
      const decoratedUrl = linker.decorateUrl('https://blog.example.com/article');
      expect(decoratedUrl).toContain('_stm=');

      // Extract the _stm parameter
      const url = new URL(decoratedUrl);
      const stmParam = url.searchParams.get('_stm');
      expect(stmParam).toBeTruthy();

      // Simulate arrival on target domain
      Object.defineProperty(window, 'location', {
        value: {
          href: decoratedUrl,
          pathname: '/article',
          search: `?_stm=${stmParam}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      // Read the cross-domain parameter
      const payload = CrossDomainLinker.readParam(config.crossDomainExpiry);
      expect(payload).not.toBeNull();
      expect(payload!.v).toBe(sourceSession.visitor_id);
      expect(payload!.s).toBe(sourceSession.id);

      // Create session on target domain with cross-domain input
      const targetStorage = new Storage(); // Fresh storage (different domain)
      const targetTabStorage = new TabStorage();
      const targetManager = new SessionManager(targetStorage, targetTabStorage, config);

      targetManager.setCrossDomainInput({
        visitorId: payload!.v,
        sessionId: payload!.s,
        timestamp: payload!.t,
        expiry: config.crossDomainExpiry,
      });

      const targetSession = targetManager.getOrCreateSession();

      // Verify session continuity
      expect(targetSession.visitor_id).toBe(sourceSession.visitor_id);
      expect(targetSession.id).toBe(sourceSession.id);
    });

    it('should store visitor_id on target domain for future sessions', () => {
      const visitorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const sessionId = '01901234-5678-7abc-def0-123456789abc';
      const timestamp = Math.floor(Date.now() / 1000);

      // Create cross-domain payload
      const payload = encode({ v: visitorId, s: sessionId, t: timestamp });

      // Simulate arrival on target domain
      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${payload}`,
          pathname: '/page',
          search: `?_stm=${payload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const crossDomainPayload = CrossDomainLinker.readParam(config.crossDomainExpiry);

      // Create session on target domain
      const targetManager = new SessionManager(storage, tabStorage, config);
      targetManager.setCrossDomainInput({
        visitorId: crossDomainPayload!.v,
        sessionId: crossDomainPayload!.s,
        timestamp: crossDomainPayload!.t,
        expiry: config.crossDomainExpiry,
      });
      targetManager.getOrCreateSession();

      // Verify visitor_id is stored (Storage class adds stm_ prefix internally)
      const storedVisitorId = storage.get<string>('visitor_id');
      expect(storedVisitorId).toBe(visitorId);

      // Create new session later (without cross-domain params)
      vi.advanceTimersByTime(31 * 60 * 1000); // Expire session

      Object.defineProperty(window, 'location', {
        value: {
          href: 'https://blog.example.com/other-page',
          pathname: '/other-page',
          search: '',
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const newManager = new SessionManager(storage, tabStorage, config);
      const newSession = newManager.getOrCreateSession();

      // Same visitor, different session
      expect(newSession.visitor_id).toBe(visitorId);
      expect(newSession.id).not.toBe(sessionId);
    });
  });

  describe('Expired Payload Handling', () => {
    it('should create new session when cross-domain payload is expired', () => {
      const visitorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const sessionId = '01901234-5678-7abc-def0-123456789abc';
      const oldTimestamp = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago

      const payload = encode({ v: visitorId, s: sessionId, t: oldTimestamp });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${payload}`,
          pathname: '/page',
          search: `?_stm=${payload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      // readParam should return null for expired payload
      const crossDomainPayload = CrossDomainLinker.readParam(120); // 2 min expiry
      expect(crossDomainPayload).toBeNull();

      // Session manager should create new session
      const manager = new SessionManager(storage, tabStorage, config);
      const session = manager.getOrCreateSession();

      expect(session.visitor_id).not.toBe(visitorId);
      expect(session.id).not.toBe(sessionId);
    });

    it('should reject payload with future timestamp beyond tolerance', () => {
      const visitorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const sessionId = '01901234-5678-7abc-def0-123456789abc';
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future

      const payload = encode({ v: visitorId, s: sessionId, t: futureTimestamp });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${payload}`,
          pathname: '/page',
          search: `?_stm=${payload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const crossDomainPayload = CrossDomainLinker.readParam(120);
      expect(crossDomainPayload).toBeNull();
    });

    it('should accept payload with slight clock skew (within 60s tolerance)', () => {
      const visitorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const sessionId = '01901234-5678-7abc-def0-123456789abc';
      const slightFutureTimestamp = Math.floor(Date.now() / 1000) + 30; // 30 seconds in future

      const payload = encode({ v: visitorId, s: sessionId, t: slightFutureTimestamp });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${payload}`,
          pathname: '/page',
          search: `?_stm=${payload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const crossDomainPayload = CrossDomainLinker.readParam(120);
      expect(crossDomainPayload).not.toBeNull();
      expect(crossDomainPayload!.v).toBe(visitorId);
    });
  });

  describe('Invalid Payload Handling', () => {
    it('should create new session for malformed base64', () => {
      Object.defineProperty(window, 'location', {
        value: {
          href: 'https://blog.example.com/page?_stm=not-valid-base64!!!',
          pathname: '/page',
          search: '?_stm=not-valid-base64!!!',
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const crossDomainPayload = CrossDomainLinker.readParam(120);
      expect(crossDomainPayload).toBeNull();

      const manager = new SessionManager(storage, tabStorage, config);
      const session = manager.getOrCreateSession();

      // Should create fresh session
      expect(session.id).toBeTruthy();
      expect(session.visitor_id).toBeTruthy();
    });

    it('should create new session for invalid UUID format', () => {
      const invalidPayload = encode({
        v: 'not-a-uuid',
        s: 'also-not-a-uuid',
        t: Math.floor(Date.now() / 1000),
      });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${invalidPayload}`,
          pathname: '/page',
          search: `?_stm=${invalidPayload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const crossDomainPayload = CrossDomainLinker.readParam(120);
      expect(crossDomainPayload).toBeNull();
    });

    it('should create new session for missing fields in payload', () => {
      // Encode partial payload (missing session_id)
      const partialPayload = btoa(JSON.stringify({ v: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', t: Date.now() }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${partialPayload}`,
          pathname: '/page',
          search: `?_stm=${partialPayload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      const crossDomainPayload = CrossDomainLinker.readParam(120);
      expect(crossDomainPayload).toBeNull();
    });
  });

  describe('Parameter Stripping', () => {
    it('should strip _stm parameter from URL after reading', () => {
      const visitorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const sessionId = '01901234-5678-7abc-def0-123456789abc';
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = encode({ v: visitorId, s: sessionId, t: timestamp });

      const replaceStateSpy = vi.fn();
      Object.defineProperty(window, 'history', {
        value: {
          ...originalHistory,
          replaceState: replaceStateSpy,
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${payload}&other=value`,
          pathname: '/page',
          search: `?_stm=${payload}&other=value`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      CrossDomainLinker.stripParam();

      expect(replaceStateSpy).toHaveBeenCalledWith(
        undefined, // window.history.state
        '',
        '/page?other=value' // Implementation uses relative path
      );
    });

    it('should preserve other query parameters when stripping', () => {
      const payload = encode({
        v: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        s: '01901234-5678-7abc-def0-123456789abc',
        t: Math.floor(Date.now() / 1000),
      });

      const replaceStateSpy = vi.fn();
      Object.defineProperty(window, 'history', {
        value: {
          ...originalHistory,
          replaceState: replaceStateSpy,
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?utm_source=google&_stm=${payload}&page=2`,
          pathname: '/page',
          search: `?utm_source=google&_stm=${payload}&page=2`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      CrossDomainLinker.stripParam();

      expect(replaceStateSpy).toHaveBeenCalledWith(
        undefined,
        '',
        '/page?utm_source=google&page=2'
      );
    });

    it('should handle URL with only _stm parameter', () => {
      const payload = encode({
        v: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        s: '01901234-5678-7abc-def0-123456789abc',
        t: Math.floor(Date.now() / 1000),
      });

      const replaceStateSpy = vi.fn();
      Object.defineProperty(window, 'history', {
        value: {
          ...originalHistory,
          replaceState: replaceStateSpy,
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(window, 'location', {
        value: {
          href: `https://blog.example.com/page?_stm=${payload}`,
          pathname: '/page',
          search: `?_stm=${payload}`,
          hash: '',
          origin: 'https://blog.example.com',
          hostname: 'blog.example.com',
        },
        writable: true,
        configurable: true,
      });

      CrossDomainLinker.stripParam();

      expect(replaceStateSpy).toHaveBeenCalledWith(
        undefined,
        '',
        '/page'
      );
    });
  });

  describe('decorateUrl API', () => {
    it('should decorate URLs for configured domains', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com', 'shop.example.com'],
        expiry: 120,
        debug: false,
      });

      const visitorId = 'visitor-123';
      const sessionId = 'session-456';
      linker.setIdGetters(
        () => visitorId,
        () => sessionId
      );

      const decorated = linker.decorateUrl('https://blog.example.com/article');
      expect(decorated).toContain('_stm=');

      // Verify payload can be decoded
      const url = new URL(decorated);
      const stm = url.searchParams.get('_stm');
      const decoded = JSON.parse(atob(stm!.replace(/-/g, '+').replace(/_/g, '/')));
      expect(decoded.v).toBe(visitorId);
      expect(decoded.s).toBe(sessionId);
    });

    it('should not decorate URLs for unconfigured domains', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      const decorated = linker.decorateUrl('https://other-site.com/page');
      expect(decorated).toBe('https://other-site.com/page');
      expect(decorated).not.toContain('_stm=');
    });

    it('should not decorate same-origin URLs', () => {
      const linker = new CrossDomainLinker({
        domains: ['www.example.com', 'blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      // Same as current origin
      const decorated = linker.decorateUrl('https://www.example.com/other-page');
      expect(decorated).toBe('https://www.example.com/other-page');
      expect(decorated).not.toContain('_stm=');
    });

    it('should preserve existing query parameters when decorating', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      const decorated = linker.decorateUrl('https://blog.example.com/page?existing=param&other=value');
      expect(decorated).toContain('existing=param');
      expect(decorated).toContain('other=value');
      expect(decorated).toContain('_stm=');
    });

    it('should preserve hash when decorating', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      const decorated = linker.decorateUrl('https://blog.example.com/page#section');
      expect(decorated).toContain('#section');
      expect(decorated).toContain('_stm=');
    });
  });

  describe('Click Interception', () => {
    it('should decorate link href on click to configured domain', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      linker.start();

      // Create a link element
      const link = document.createElement('a');
      link.href = 'https://blog.example.com/article';
      document.body.appendChild(link);

      // Simulate click
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(clickEvent);

      // Check that href was decorated
      expect(link.href).toContain('_stm=');

      // Cleanup
      linker.stop();
      document.body.removeChild(link);
    });

    it('should not decorate link to unconfigured domain', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      linker.start();

      const link = document.createElement('a');
      link.href = 'https://other-site.com/page';
      const originalHref = link.href;
      document.body.appendChild(link);

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(clickEvent);

      expect(link.href).toBe(originalHref);
      expect(link.href).not.toContain('_stm=');

      linker.stop();
      document.body.removeChild(link);
    });

    it('should stop intercepting clicks after stop()', () => {
      const linker = new CrossDomainLinker({
        domains: ['blog.example.com'],
        expiry: 120,
        debug: false,
      });

      linker.setIdGetters(
        () => 'visitor-123',
        () => 'session-456'
      );

      linker.start();
      linker.stop();

      const link = document.createElement('a');
      link.href = 'https://blog.example.com/article';
      const originalHref = link.href;
      document.body.appendChild(link);

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(clickEvent);

      expect(link.href).toBe(originalHref);

      document.body.removeChild(link);
    });
  });

  describe('Full Flow E2E', () => {
    it('should maintain session through complete cross-domain journey', () => {
      // Step 1: Create session on source domain (www.example.com)
      const sourceManager = new SessionManager(storage, tabStorage, config);
      const sourceSession = sourceManager.getOrCreateSession();
      const originalVisitorId = sourceSession.visitor_id;
      const originalSessionId = sourceSession.id;

      // Step 2: Create linker and decorate URL
      const linker = new CrossDomainLinker({
        domains: config.crossDomains,
        expiry: config.crossDomainExpiry,
        debug: false,
      });
      linker.setIdGetters(
        () => sourceManager.getVisitorId(),
        () => sourceManager.getSessionId()
      );

      const decoratedUrl = linker.decorateUrl('https://blog.example.com/article');

      // Step 3: Simulate navigation to target domain
      const url = new URL(decoratedUrl);
      Object.defineProperty(window, 'location', {
        value: {
          href: decoratedUrl,
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
          origin: url.origin,
          hostname: url.hostname,
        },
        writable: true,
        configurable: true,
      });

      // Step 4: Read and validate payload on target domain
      const payload = CrossDomainLinker.readParam(config.crossDomainExpiry);
      expect(payload).not.toBeNull();

      // Step 5: Create session on target domain
      const targetStorage = new Storage();
      const targetTabStorage = new TabStorage();
      const targetManager = new SessionManager(targetStorage, targetTabStorage, config);

      targetManager.setCrossDomainInput({
        visitorId: payload!.v,
        sessionId: payload!.s,
        timestamp: payload!.t,
        expiry: config.crossDomainExpiry,
      });

      const targetSession = targetManager.getOrCreateSession();

      // Step 6: Verify complete session continuity
      expect(targetSession.visitor_id).toBe(originalVisitorId);
      expect(targetSession.id).toBe(originalSessionId);

      // Step 7: Verify visitor persisted for future sessions on target domain
      expect(targetStorage.get<string>('visitor_id')).toBe(originalVisitorId);
    });
  });
});
