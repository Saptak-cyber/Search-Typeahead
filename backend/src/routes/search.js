import { Router } from 'express';
import { enqueueSearch } from '../services/searchService.js';
import { flushOnce } from '../services/batchWriter.js';

export const searchRouter = Router();

// POST /search { query }
// Dummy search endpoint: records the submission (async, batched) and returns
// the required { message: "Searched" } response.
searchRouter.post('/search', async (req, res, next) => {
  try {
    const query = req.body?.query;
    const result = await enqueueSearch(query);

    // Size-based flush trigger: if the buffer is full, flush now (fire-and-forget)
    // rather than waiting for the interval.
    if (result.flushSoon) flushOnce().catch(() => {});

    res.json({ message: 'Searched' });
  } catch (err) {
    next(err);
  }
});
