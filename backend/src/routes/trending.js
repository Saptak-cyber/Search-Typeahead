import { Router } from 'express';
import { topTrending } from '../services/trendingService.js';
import { config } from '../config.js';

export const trendingRouter = Router();

// GET /trending?limit=10  -> top recency-ranked queries
trendingRouter.get('/trending', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || config.suggestLimit, 50);
    res.json({ trending: await topTrending(limit) });
  } catch (err) {
    next(err);
  }
});
