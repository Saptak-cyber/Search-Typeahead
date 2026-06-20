import { Router } from 'express';
import { cacheClient } from '../cache/cacheClient.js';
import { normalize } from '../config.js';

export const cacheDebugRouter = Router();

// GET /cache/debug?prefix=<prefix>&mode=basic|recency
// Shows which Redis node owns the prefix key (via consistent hashing) and whether
// it is currently a hit or miss.
cacheDebugRouter.get('/cache/debug', async (req, res, next) => {
  try {
    const prefix = normalize(req.query.prefix ?? '');
    const mode = req.query.mode === 'recency' ? 'recency' : 'basic';
    if (!prefix) return res.status(400).json({ error: 'prefix is required' });
    res.json(await cacheClient.debug(prefix, mode));
  } catch (err) {
    next(err);
  }
});
