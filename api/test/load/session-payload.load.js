/**
 * K6 Load Test for V3 Session Payload Endpoint
 *
 * Run with:
 *   k6 run session-payload.load.js \
 *     -e API_URL=http://localhost:3000 \
 *     -e API_KEY=<your-api-key> \
 *     -e WORKSPACE_ID=<workspace-id>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  scenarios: {
    // Scenario 1: Normal load
    normal_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '1m',
      exec: 'normalPayload',
    },
    // Scenario 2: Large payloads
    large_payloads: {
      executor: 'constant-vus',
      vus: 5,
      duration: '1m',
      exec: 'largePayload',
      startTime: '1m',
    },
    // Scenario 3: Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      exec: 'normalPayload',
      startTime: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'], // Less than 1% failure rate
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'test-api-key';
const WORKSPACE_ID = __ENV.WORKSPACE_ID || 'load-test-ws';

function createPageviewAction(pageNumber) {
  return {
    type: 'pageview',
    path: `/page-${pageNumber}`,
    page_number: pageNumber,
    duration: Math.floor(Math.random() * 30000) + 1000,
    scroll: Math.floor(Math.random() * 100),
    entered_at: Date.now() - 5000,
    exited_at: Date.now(),
  };
}

function createGoalAction(name, pageNumber) {
  return {
    type: 'goal',
    name: name,
    path: `/page-${pageNumber}`,
    page_number: pageNumber,
    timestamp: Date.now(),
    value: Math.random() * 100,
  };
}

// Normal payload: 3-5 pageviews, 0-2 goals
export function normalPayload() {
  const sessionId = `load-${randomString(8)}`;
  const numPageviews = Math.floor(Math.random() * 3) + 3;
  const numGoals = Math.floor(Math.random() * 3);

  const actions = [];
  for (let i = 1; i <= numPageviews; i++) {
    actions.push(createPageviewAction(i));
    if (i <= numGoals) {
      actions.push(createGoalAction(`goal_${i}`, i));
    }
  }

  const payload = {
    workspace_id: WORKSPACE_ID,
    session_id: sessionId,
    actions: actions,
    attributes: {
      landing_page: 'https://example.com/landing',
      browser: 'Chrome',
      os: 'macOS',
    },
    created_at: Date.now() - 60000,
    updated_at: Date.now(),
  };

  const response = http.post(
    `${BASE_URL}/api/track.session`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
    },
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'success is true': (r) => JSON.parse(r.body).success === true,
    'checkpoint returned': (r) => JSON.parse(r.body).checkpoint !== undefined,
  });

  sleep(0.1);
}

// Large payload: 500 actions (stress test MAX_ACTIONS limit)
export function largePayload() {
  const sessionId = `load-large-${randomString(8)}`;
  const numActions = 500;

  const actions = [];
  for (let i = 1; i <= numActions; i++) {
    actions.push(createPageviewAction(i));
  }

  const payload = {
    workspace_id: WORKSPACE_ID,
    session_id: sessionId,
    actions: actions,
    attributes: {
      landing_page: 'https://example.com/landing',
    },
    created_at: Date.now() - 60000,
    updated_at: Date.now(),
  };

  const response = http.post(
    `${BASE_URL}/api/track.session`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      timeout: '30s',
    },
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'all actions processed': (r) =>
      JSON.parse(r.body).checkpoint === numActions,
  });

  sleep(1);
}
