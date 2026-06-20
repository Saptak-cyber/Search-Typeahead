import { redisOps } from '../cache/redisOps.js';
import { config, BUFFER_KEY, normalize } from '../config.js';
import { metrics } from '../metrics/metrics.js';
import { bumpRecency } from './trendingService.js';

// Record a search submission WITHOUT touching Postgres synchronously.
// The query is pushed onto a Redis LIST (durable across an app crash) and the
// recency score is bumped immediately so trending reacts in real time. The
// BatchWriter drains the list and writes aggregated counts to Postgres later.
export async function enqueueSearch(rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return { buffered: false };

  await redisOps.rpush(BUFFER_KEY, query);
  await bumpRecency(query);
  metrics.inc('searchesAccepted');

  // Surface buffer pressure so the writer can flush early (size-based trigger).
  const len = await redisOps.llen(BUFFER_KEY);
  return { buffered: true, bufferLength: len, flushSoon: len >= config.batchSize };
}
