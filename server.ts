import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import {
  exportScoresCsv,
  flushPendingSyncQueue,
  getDefaultEvent,
  getEventAnalytics,
  getStateSnapshot,
  getSyncQueueItems,
  registerSyncBroadcastCallback,
  resetStageOrEvent,
  startNewSession,
  submitAuthoritativeScore,
  testAppsScriptConnection,
  undoScoreEvent,
  updateActiveSessionParams,
  updateEventConfig,
} from './server/scoring.ts';

async function startServer() {
  initDatabase();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  type TaggedSocket = WebSocket & { deviceId?: string };

  function getDeviceId(req: express.Request): string {
    const header = req.header('x-device-id');
    const query = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    const body = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
    return (header || query || body || 'default').trim().slice(0, 64) || 'default';
  }

  function broadcastState(eventId: string, extra?: Record<string, unknown>) {
    for (const rawClient of wss.clients) {
      const client = rawClient as TaggedSocket;
      if (client.readyState === WebSocket.OPEN) {
        const snapshot = getStateSnapshot(eventId, client.deviceId || 'default');
        client.send(
          JSON.stringify({
            type: 'state:update',
            snapshot,
            ...extra,
          })
        );
      }
    }
  }

  registerSyncBroadcastCallback((eventId) => {
    broadcastState(eventId, { reason: 'sync:updated' });
  });

  wss.on('connection', (rawWs, req) => {
    const ws = rawWs as TaggedSocket;
    try {
      const parsedUrl = new URL(req.url || '/ws', 'http://localhost');
      ws.deviceId = (parsedUrl.searchParams.get('deviceId') || 'default').trim().slice(0, 64) || 'default';
      const event = getDefaultEvent();
      const snapshot = getStateSnapshot(event.id, ws.deviceId);
      ws.send(JSON.stringify({ type: 'state:init', snapshot }));
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to load initial state',
        })
      );
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed socket frames
      }
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/state', (req, res) => {
    try {
      const event = getDefaultEvent();
      res.json(getStateSnapshot(event.id, getDeviceId(req)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch state' });
    }
  });

  app.put('/api/event/config', (req, res) => {
    try {
      const event = getDefaultEvent();
      const snapshot = updateEventConfig(event.id, req.body ?? {}, getDeviceId(req));
      broadcastState(event.id, { reason: 'event:updated' });
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid event configuration' });
    }
  });

  app.post('/api/session/start', (req, res) => {
    try {
      const event = getDefaultEvent();
      const deviceId = getDeviceId(req);
      const { stage, roundNumber, selectionSize, rangeStart, rangeEnd } = req.body ?? {};
      if (stage !== 'team' && stage !== 'individual') {
        res.status(400).json({ error: 'Stage must be "team" or "individual"' });
        return;
      }
      const snapshot = startNewSession(event.id, {
        deviceId,
        stage,
        roundNumber: Number(roundNumber ?? 1),
        selectionSize: Number(selectionSize ?? (stage === 'team' ? event.teamCount : event.individualCount)),
        rangeStart: rangeStart !== undefined ? Number(rangeStart) : undefined,
        rangeEnd: rangeEnd !== undefined ? Number(rangeEnd) : undefined,
      });
      broadcastState(event.id, { reason: 'session:started' });
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start session' });
    }
  });

  app.patch('/api/session/active', (req, res) => {
    try {
      const event = getDefaultEvent();
      const snapshot = updateActiveSessionParams(event.id, {
        ...(req.body ?? {}),
        deviceId: getDeviceId(req),
      });
      broadcastState(event.id, { reason: 'session:updated' });
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update session' });
    }
  });

  app.post('/api/scores', (req, res) => {
    try {
      const event = getDefaultEvent();
      const body = req.body ?? {};
      const result = submitAuthoritativeScore({
        eventId: event.id,
        deviceId: getDeviceId(req),
        sessionId: body.sessionId,
        stage: body.stage === 'individual' ? 'individual' : 'team',
        roundNumber: Number(body.roundNumber),
        participantNumber: Number(body.participantNumber),
        isCorrect: Boolean(body.isCorrect),
        useLuckyBell: Boolean(body.useLuckyBell),
        useGoldenGamble: Boolean(body.useGoldenGamble),
        clientTxId: typeof body.clientTxId === 'string' ? body.clientTxId : undefined,
      });

      broadcastState(event.id, { reason: 'score:recorded', scoreEvent: result.scoreEvent });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Score submission rejected';
      const status =
        message.includes('TAMPER_BLOCKED') ||
        message.includes('BAN_ENFORCED') ||
        message.includes('ALREADY_SCORED') ||
        message.includes('INVALID_QUESTION')
          ? 409
          : 400;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/scores/undo', (req, res) => {
    try {
      const event = getDefaultEvent();
      const { scoreId } = req.body ?? {};
      const result = undoScoreEvent(
        event.id,
        typeof scoreId === 'string' ? scoreId : undefined,
        getDeviceId(req)
      );
      broadcastState(event.id, { reason: 'score:undone' });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to undo score' });
    }
  });

  app.post('/api/event/reset', (req, res) => {
    try {
      const event = getDefaultEvent();
      const scope = req.body?.scope === 'stage' ? 'stage' : 'all';
      const stage = req.body?.stage === 'team' || req.body?.stage === 'individual' ? req.body.stage : undefined;
      const snapshot = resetStageOrEvent(event.id, scope, stage, getDeviceId(req));
      broadcastState(event.id, { reason: 'event:reset' });
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to reset scores' });
    }
  });

  app.get('/api/analytics', (_req, res) => {
    try {
      const event = getDefaultEvent();
      res.json(getEventAnalytics(event.id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute analytics' });
    }
  });

  app.get('/api/sheets/queue', (_req, res) => {
    try {
      const event = getDefaultEvent();
      res.json({ items: getSyncQueueItems(event.id) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch sync queue' });
    }
  });

  app.post('/api/sheets/sync-now', async (req, res) => {
    try {
      const event = getDefaultEvent();
      const result = await flushPendingSyncQueue(event.id);
      res.json({ ...result, snapshot: getStateSnapshot(event.id, getDeviceId(req)) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  app.post('/api/sheets/test', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      const result = await testAppsScriptConnection(url);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
    }
  });

  app.get('/api/sheets/appscript-code', (_req, res) => {
    try {
      const codePath = path.resolve(process.cwd(), 'appscript', 'Code.gs');
      const code = fs.readFileSync(codePath, 'utf-8');
      res.json({ code });
    } catch {
      res.status(500).json({ error: 'Unable to read appscript/Code.gs' });
    }
  });

  app.get('/api/export/csv', (_req, res) => {
    try {
      const event = getDefaultEvent();
      const csv = exportScoresCsv(event.id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="golden-bell-scores.csv"');
      res.send(csv);
    } catch {
      res.status(500).json({ error: 'Failed to export CSV' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Golden Bell Judge server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
