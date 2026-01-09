/**
 * Mock server for E2E tests
 *
 * Serves the SDK bundle and test fixtures, captures events sent by the SDK,
 * and provides test endpoints for retrieving/resetting captured data.
 *
 * Updated for V3 SessionPayload format with actions[] array.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// V3 SessionPayload types
interface PageviewAction {
  type: 'pageview';
  path: string;
  page_number: number;
  duration: number;
  scroll: number;
  entered_at: number;
  exited_at: number;
}

interface GoalAction {
  type: 'goal';
  name: string;
  path: string;
  page_number: number;
  timestamp: number;
  value?: number;
  properties?: Record<string, string>;
}

type Action = PageviewAction | GoalAction;

interface CurrentPage {
  path: string;
  page_number: number;
  entered_at: number;
  scroll: number;
}

interface SessionPayload {
  workspace_id: string;
  session_id: string;
  actions: Action[];
  current_page?: CurrentPage;
  checkpoint?: number;
  attributes?: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  sdk_version: string;
  sent_at?: number; // Set at HTTP send time for clock skew detection
}

// Store captured session payloads
interface CapturedPayload {
  payload: SessionPayload;
  _received_at: number;
  _raw_body: string;
}

let events: CapturedPayload[] = [];
let responseDelay = 0;
let shouldFail = false;
let failCount = 0;
let maxFails = 0;

// Parse JSON bodies
app.use(express.json());

// Parse text/plain bodies (beacon sends as text)
app.use(express.text({ type: 'text/plain' }));

// Serve SDK dist
app.use('/dist', express.static(path.join(__dirname, '../../../dist')));

// Serve test fixtures
app.use('/', express.static(path.join(__dirname, '../fixtures')));

// Capture session payloads from SDK (SDK sends to /api/track)
app.post('/api/track', async (req, res) => {
  // Apply configured delay
  if (responseDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, responseDelay));
  }

  // Simulate failures if configured
  if (shouldFail || (maxFails > 0 && failCount < maxFails)) {
    failCount++;
    res.status(500).json({ error: 'Simulated failure' });
    return;
  }

  // Parse body - could be JSON object or JSON string
  let payload: SessionPayload;
  let rawBody: string;

  if (typeof req.body === 'string') {
    rawBody = req.body;
    try {
      payload = JSON.parse(req.body) as SessionPayload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
  } else {
    rawBody = JSON.stringify(req.body);
    payload = req.body as SessionPayload;
  }

  events.push({
    payload,
    _received_at: Date.now(),
    _raw_body: rawBody,
  });

  // Return checkpoint (number of actions received) for SDK acknowledgment
  const checkpoint = payload.actions?.length ?? 0;
  res.json({ ok: true, checkpoint });
});

// Get captured events for test assertions
app.get('/api/test/events', (_req, res) => {
  res.json(events);
});

// Get payloads filtered by action type or goal name
// V3: Searches actions[] array for matching type or goal name
app.get('/api/test/events/:type', (req, res) => {
  const { type } = req.params;
  const filtered = events.filter((e) => {
    const p = e.payload;
    if (!p.actions) return false;

    // Match by action type (pageview, goal)
    if (p.actions.some((a: Action) => a.type === type)) return true;

    // Match by goal name (for trackGoal calls)
    if (p.actions.some((a: Action) => a.type === 'goal' && (a as GoalAction).name === type)) return true;

    return false;
  });
  res.json(filtered);
});

// Get all goals
app.get('/api/test/goals', (_req, res) => {
  const goals: { payload: SessionPayload; goal: GoalAction; _received_at: number }[] = [];
  for (const e of events) {
    if (!e.payload.actions) continue;
    for (const action of e.payload.actions) {
      if (action.type === 'goal') {
        goals.push({
          payload: e.payload,
          goal: action as GoalAction,
          _received_at: e._received_at,
        });
      }
    }
  }
  res.json(goals);
});

// Get all pageviews
app.get('/api/test/pageviews', (_req, res) => {
  const pageviews: { payload: SessionPayload; pageview: PageviewAction; _received_at: number }[] = [];
  for (const e of events) {
    if (!e.payload.actions) continue;
    for (const action of e.payload.actions) {
      if (action.type === 'pageview') {
        pageviews.push({
          payload: e.payload,
          pageview: action as PageviewAction,
          _received_at: e._received_at,
        });
      }
    }
  }
  res.json(pageviews);
});

// Get latest payload for a session
app.get('/api/test/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionPayloads = events.filter((e) => e.payload.session_id === sessionId);
  if (sessionPayloads.length === 0) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  // Return the most recent payload
  res.json(sessionPayloads[sessionPayloads.length - 1]);
});

// Clear events between tests
app.post('/api/test/reset', (_req, res) => {
  events = [];
  responseDelay = 0;
  shouldFail = false;
  failCount = 0;
  maxFails = 0;
  res.json({ ok: true });
});

// Configure response delay (ms)
app.post('/api/test/delay/:ms', (req, res) => {
  responseDelay = parseInt(req.params.ms, 10);
  res.json({ ok: true, delay: responseDelay });
});

// Configure failure mode
app.post('/api/test/fail', (req, res) => {
  shouldFail = true;
  res.json({ ok: true });
});

// Configure limited failures (fail N times then succeed)
app.post('/api/test/fail/:count', (req, res) => {
  maxFails = parseInt(req.params.count, 10);
  failCount = 0;
  res.json({ ok: true, maxFails });
});

// Stop failure mode
app.post('/api/test/succeed', (_req, res) => {
  shouldFail = false;
  maxFails = 0;
  failCount = 0;
  res.json({ ok: true });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3333;
app.listen(PORT, () => {
  console.log(`Mock server running on http://localhost:${PORT}`);
});
