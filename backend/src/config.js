import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the project root (one level above backend/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4000),
  pgUrl: process.env.PG_URL || 'postgres://typeahead:typeahead@localhost:5432/typeahead',

  // Cache nodes: "host:port,host:port,..." -> [{ id, host, port }]
  redisNodes: (process.env.REDIS_NODES || 'localhost:6379,localhost:6380,localhost:6381')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hostPort) => {
      const [host, port] = hostPort.split(':');
      return { id: `${host}:${port}`, host, port: Number(port) };
    }),

  cacheTtlSeconds: num(process.env.CACHE_TTL_SECONDS, 60),
  cacheTtlRecencySeconds: num(process.env.CACHE_TTL_RECENCY_SECONDS, 10),
  ringReplicas: num(process.env.RING_REPLICAS, 150),

  flushIntervalMs: num(process.env.FLUSH_INTERVAL_MS, 2000),
  batchSize: num(process.env.BATCH_SIZE, 500),

  trendBoost: num(process.env.TREND_BOOST, 1),
  decayFactor: num(process.env.DECAY_FACTOR, 0.95),
  decayIntervalMs: num(process.env.DECAY_INTERVAL_MS, 10000),
  recencyWeight: num(process.env.RECENCY_WEIGHT, 0.5),

  suggestLimit: num(process.env.SUGGEST_LIMIT, 10),
};

// Keys / names shared across modules.
export const BUFFER_KEY = 'search:buffer';
export const TRENDING_KEY = 'trending';

// Normalize a query/prefix consistently everywhere (ingestion, search, suggest).
export function normalize(text) {
  return (text ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}
