/**
 * Mock server for E2E tests
 *
 * Serves the SDK bundle and test fixtures, captures events sent by the SDK,
 * and provides test endpoints for retrieving/resetting captured data.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Store captured events
interface CapturedEvent {
  payload: unknown;
  _received_at: number;
  _raw_body: string;
}

let events: CapturedEvent[] = [];
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

// Capture events from SDK (SDK sends to /api/track)
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
  let payload: unknown;
  let rawBody: string;

  if (typeof req.body === 'string') {
    rawBody = req.body;
    try {
      payload = JSON.parse(req.body);
    } catch {
      payload = req.body;
    }
  } else {
    rawBody = JSON.stringify(req.body);
    payload = req.body;
  }

  events.push({
    payload,
    _received_at: Date.now(),
    _raw_body: rawBody,
  });

  res.json({ ok: true });
});

// Get captured events for test assertions
app.get('/api/test/events', (_req, res) => {
  res.json(events);
});

// Get events filtered by name
// Supports: event type (name), custom event name (event_name), conversion action (conversion_name)
app.get('/api/test/events/:name', (req, res) => {
  const { name } = req.params;
  const filtered = events.filter((e) => {
    const p = e.payload as Record<string, unknown>;
    // Match by event type (screen_view, ping, conversion)
    if (p.name === name) return true;
    // Match by custom event name (for trackEvent/track calls)
    if (p.event_name === name) return true;
    // Match by conversion action
    if (p.conversion_name === name) return true;
    return false;
  });
  res.json(filtered);
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
