import { Router } from 'express';
import { getSuggestions } from '../services/suggestService.js';
import { metrics } from '../metrics/metrics.js';

export const suggestRouter = Router();

// GET /suggest?q=<prefix>&mode=basic|recency
// Returns up to 10 prefix-matching suggestions. Empty/missing prefix -> [].
suggestRouter.get('/suggest', async (req, res, next) => {
  const start = process.hrtime.bigint();
  try {
    const q = req.query.q ?? '';
    const mode = req.query.mode === 'recency' ? 'recency' : 'basic';
    const suggestions = await getSuggestions(q, mode);
    res.json({ prefix: q, mode, suggestions });
  } catch (err) {
    next(err);
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordSuggestLatency(ms);
  }
});
