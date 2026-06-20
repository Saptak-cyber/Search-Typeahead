import { Router } from 'express';
import { metrics } from '../metrics/metrics.js';
import { redisOps } from '../cache/redisOps.js';
import { config, BUFFER_KEY } from '../config.js';

export const statsRouter = Router();

// GET /stats -> cache hit rate, db read/write counts, write-reduction ratio, latency.
statsRouter.get('/stats', async (_req, res, next) => {
  try {
    const bufferLength = await redisOps.llen(BUFFER_KEY);
    res.json({
      ...metrics.snapshot(),
      bufferLength,
      cacheNodes: config.redisNodes.map((n) => n.id),
    });
  } catch (err) {
    next(err);
  }
});
