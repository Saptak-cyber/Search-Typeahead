import { redisOps } from '../cache/redisOps.js';
import { cacheClient } from '../cache/cacheClient.js';
import { bulkUpsert } from '../db/repo.js';
import { config, BUFFER_KEY } from '../config.js';

// Periodic batch writer. Drains the search buffer, aggregates repeated queries into
// a single count delta each, writes them all in ONE UPSERT statement, then
// invalidates the affected prefix caches so suggestions pick up the new counts.
//
// Failure trade-off: draining uses LRANGE then LTRIM (not atomic). If the process
// dies between them, the same items are re-read next start -> at-least-once, so a
// query may be counted twice. For popularity ranking a rare small over-count is
// acceptable; we favor durability (no lost writes) over exactly-once.
let timer = null;
let flushing = false;

export async function flushOnce() {
  if (flushing) return 0;
  flushing = true;
  try {
    const items = await redisOps.lrange(BUFFER_KEY, 0, config.batchSize - 1);
    if (items.length === 0) return 0;

    // Aggregate: repeated queries collapse to one row with the summed delta.
    const deltas = new Map();
    for (const q of items) deltas.set(q, (deltas.get(q) ?? 0) + 1);

    await bulkUpsert(deltas);

    // Remove exactly the items we processed.
    await redisOps.ltrim(BUFFER_KEY, items.length, -1);

    // Invalidate caches for every distinct query we just changed.
    await Promise.all([...deltas.keys()].map((q) => cacheClient.invalidateForQuery(q)));

    return items.length;
  } finally {
    flushing = false;
  }
}

export function startBatchWriter() {
  if (timer) return;
  timer = setInterval(() => {
    flushOnce().catch((e) => console.error('[batchWriter] flush error', e));
  }, config.flushIntervalMs);
  timer.unref?.();
}

export function stopBatchWriter() {
  if (timer) clearInterval(timer);
  timer = null;
}
