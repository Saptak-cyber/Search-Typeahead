import { cacheClient } from '../cache/cacheClient.js';
import { prefixSearch } from '../db/repo.js';
import { recencyScores } from './trendingService.js';
import { config, normalize } from '../config.js';

// Blend all-time popularity with recency. Both signals are min-max normalized
// within the candidate set so they're comparable, then weighted:
//   final = (1 - w)*popularity_norm + w*recency_norm
function blendByRecency(candidates, recencyMap) {
  const counts = candidates.map((c) => c.count);
  const recs = candidates.map((c) => recencyMap.get(c.query) ?? 0);
  const maxCount = Math.max(...counts, 1);
  const maxRec = Math.max(...recs, 1);
  const w = config.recencyWeight;

  return candidates
    .map((c) => {
      const popNorm = c.count / maxCount;
      const recNorm = (recencyMap.get(c.query) ?? 0) / maxRec;
      const score = (1 - w) * popNorm + w * recNorm;
      return { ...c, score: Number(score.toFixed(4)), recency: recencyMap.get(c.query) ?? 0 };
    })
    .sort((a, b) => b.score - a.score);
}

// Suggestions for a prefix.
//   mode='basic'   -> sorted purely by all-time count (60% version)
//   mode='recency' -> blended popularity + recency (20% trending version)
// Flow: consistent-hash-routed cache -> Postgres fallback -> cache fill.
export async function getSuggestions(prefix, mode = 'basic') {
  const p = normalize(prefix);
  if (!p) return [];

  const cached = await cacheClient.get(p, mode);
  if (cached) return cached;

  // Miss: pull candidates from the primary store.
  let candidates = await prefixSearch(p, mode === 'recency' ? config.suggestLimit * 3 : config.suggestLimit);

  let suggestions;
  if (mode === 'recency') {
    // Over-fetch (limit*3) so recency can promote queries the count-only top-N missed.
    const recMap = await recencyScores(candidates.map((c) => c.query));
    suggestions = blendByRecency(candidates, recMap).slice(0, config.suggestLimit);
  } else {
    suggestions = candidates.slice(0, config.suggestLimit);
  }

  const ttl = mode === 'recency' ? config.cacheTtlRecencySeconds : config.cacheTtlSeconds;
  await cacheClient.set(p, mode, suggestions, ttl);
  return suggestions;
}
