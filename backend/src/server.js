import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { ensureSchema, closePool } from './db/pool.js';
import { cacheClient } from './cache/cacheClient.js';
import { quitOps } from './cache/redisOps.js';
import { startBatchWriter, stopBatchWriter, flushOnce } from './services/batchWriter.js';
import { startDecayJob, stopDecayJob } from './services/trendingService.js';

import { suggestRouter } from './routes/suggest.js';
import { searchRouter } from './routes/search.js';
import { trendingRouter } from './routes/trending.js';
import { cacheDebugRouter } from './routes/cacheDebug.js';
import { statsRouter } from './routes/stats.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(suggestRouter);
app.use(searchRouter);
app.use(trendingRouter);
app.use(cacheDebugRouter);
app.use(statsRouter);

// Centralized error handler.
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

async function start() {
  await ensureSchema();
  startBatchWriter();
  startDecayJob();

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    console.log(`[server] cache nodes: ${config.redisNodes.map((n) => n.id).join(', ')}`);
  });

  // Graceful shutdown: stop timers, flush remaining buffered searches, close conns.
  const shutdown = async (sig) => {
    console.log(`\n[server] ${sig} received, shutting down...`);
    stopBatchWriter();
    stopDecayJob();
    server.close();
    try {
      await flushOnce(); // best-effort final flush
    } catch (e) {
      console.error('[server] final flush failed', e);
    }
    await cacheClient.quit();
    await quitOps();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((e) => {
  console.error('[server] failed to start', e);
  process.exit(1);
});
