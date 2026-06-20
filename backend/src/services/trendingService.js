import { redisOps } from '../cache/redisOps.js';
import { config, TRENDING_KEY } from '../config.js';

// Recency tracking via a Redis sorted set.
//
// - Every search ZINCRBYs the query's score by TREND_BOOST.
// - A background decay job periodically multiplies all scores by DECAY_FACTOR (<1).
//   This is what stops a query that spiked once from ranking high forever: with no
//   fresh searches its score decays geometrically toward zero and drops out.
let decayTimer = null;

export async function bumpRecency(query) {
  await redisOps.zincrby(TRENDING_KEY, config.trendBoost, query);
}

// Recency scores for a set of queries, as Map<query, score>. Used to blend with
// all-time popularity in recency-mode suggestions.
export async function recencyScores(queries) {
  if (queries.length === 0) return new Map();
  const pipe = redisOps.pipeline();
  for (const q of queries) pipe.zscore(TRENDING_KEY, q);
  const res = await pipe.exec();
  const map = new Map();
  queries.forEach((q, i) => {
    const score = res[i][1];
    map.set(q, score == null ? 0 : Number(score));
  });
  return map;
}

// Top-K trending queries for the UI section.
export async function topTrending(limit = 10) {
  const flat = await redisOps.zrevrange(TRENDING_KEY, 0, limit - 1, 'WITHSCORES');
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ query: flat[i], score: Number(Number(flat[i + 1]).toFixed(3)) });
  }
  return out;
}

async function decayTick() {
  // Multiply every member's score by DECAY_FACTOR. Drop members that have decayed
  // to near-zero so the set stays small.
  const members = await redisOps.zrange(TRENDING_KEY, 0, -1, 'WITHSCORES');
  if (members.length === 0) return;
  const pipe = redisOps.pipeline();
  for (let i = 0; i < members.length; i += 2) {
    const member = members[i];
    const newScore = Number(members[i + 1]) * config.decayFactor;
    if (newScore < 0.01) pipe.zrem(TRENDING_KEY, member);
    else pipe.zadd(TRENDING_KEY, newScore, member);
  }
  await pipe.exec();
}

export function startDecayJob() {
  if (decayTimer) return;
  decayTimer = setInterval(() => {
    decayTick().catch((e) => console.error('[trending] decay error', e));
  }, config.decayIntervalMs);
  decayTimer.unref?.();
}

export function stopDecayJob() {
  if (decayTimer) clearInterval(decayTimer);
  decayTimer = null;
}
