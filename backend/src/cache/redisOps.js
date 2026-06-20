import Redis from 'ioredis';
import { config } from '../config.js';

// The search buffer (LIST) and trending set (ZSET) are single logical structures,
// not per-prefix cache entries, so they are NOT sharded across the ring. They live
// on a dedicated connection to the first configured Redis node.
const first = config.redisNodes[0];
export const redisOps = new Redis({
  host: first.host,
  port: first.port,
  maxRetriesPerRequest: 2,
});

export async function quitOps() {
  await redisOps.quit().catch(() => {});
}
