# Architecture & Design

## 1. Overview

```
                        ┌──────────────────────────────────────────────┐
   Browser (React)      │                Express backend                │
   ───────────────▶     │                                               │
   debounced /suggest   │  /suggest ─ SuggestService ─┐                 │
   /search, /trending   │                             ▼                 │
                        │                       CacheClient ── HashRing │
                        │                             │ (consistent     │
                        │                             │   hashing)      │
                        │                             ▼                 │
                        │                    Redis node 0 / 1 / 2       │
                        │                             │ (miss)          │
                        │                             ▼                 │
                        │  /search ─ SearchService ─▶ Redis LIST buffer │
                        │                             │                 │
                        │                       BatchWriter (interval/  │
                        │                        size flush) ─ UPSERT ─▶│──▶ PostgreSQL
                        │                                               │
                        │  TrendingService ─ Redis ZSET (time-decayed)  │
                        └──────────────────────────────────────────────┘
```

Read path: `Redis (consistent-hash routed) → PostgreSQL fallback → cache fill`.
Write path: searches are buffered and written to Postgres in aggregated batches —
never synchronously per request.

## 2. Data storage

**PostgreSQL** is the source of truth: `queries(query_text PRIMARY KEY, count, updated_at)`.

- `query_text` is normalized (trimmed, lower-cased, single-spaced) everywhere via
  `normalize()` so cache keys, prefix matches, and stored rows always agree.
- Prefix suggestions use `WHERE query_text LIKE 'prefix%' ORDER BY count DESC LIMIT 10`.
  The `text_pattern_ops` B-tree index turns the `LIKE 'prefix%'` into a range scan
  (the default collation otherwise disables index use for `LIKE`); `idx_queries_count`
  helps the ordering when a prefix matches many rows.

**Why a relational store over a trie/in-memory index?** It satisfies the
"reliable primary store" requirement, gives durable counts, and is trivial to run
locally. Hot prefixes are served from cache, so the DB only pays for cold prefixes.

## 3. Distributed cache + consistent hashing

The cache layer is **three real Redis instances** (`docker-compose`), treated as
logical cache nodes on a consistent-hash ring (`backend/src/cache/hashRing.js`).

- The ring places each node at `RING_REPLICAS` (default 150) **virtual node**
  positions on a 32-bit ring (MD5 → uint32). Virtual nodes smooth out load
  imbalance that few physical nodes would otherwise cause.
- A prefix key (`suggest:<mode>:<prefix>`) is hashed to a ring point and owned by
  the first node clockwise (binary search, wrap-around).
- **Why consistent hashing:** adding or removing a node only remaps the keys in the
  arc(s) around the change — roughly `1/N` of keys — instead of rehashing the entire
  keyspace (which plain `hash(key) % N` would do). `GET /cache/debug` exposes the
  owning node + ring position so this is observable; stopping one Redis node and
  re-querying shows that only nearby prefixes move.
- **Expiry/invalidation:** entries are written with a TTL (`CACHE_TTL_SECONDS`, 60s
  basic / 10s recency) so stale data self-heals. On a batch write, the BatchWriter
  also explicitly `DEL`s every prefix key derived from each changed query
  (`i, ip, iph, …`) across their owning nodes, so count changes show up promptly.

## 4. Search submission & batch writes

`POST /search` does **not** write to Postgres. It:

1. `RPUSH`es the normalized query onto a Redis LIST (`search:buffer`),
2. bumps the trending ZSET, and
3. returns `{ "message": "Searched" }` immediately.

The **BatchWriter** (`backend/src/services/batchWriter.js`) runs every
`FLUSH_INTERVAL_MS` (2s) or earlier when the buffer reaches `BATCH_SIZE` (500). Each
flush:

1. `LRANGE`s up to `BATCH_SIZE` items,
2. **aggregates** repeated queries into one row with a summed count delta,
3. writes them all in a **single `INSERT … ON CONFLICT DO UPDATE`** statement,
4. `LTRIM`s the processed items, then invalidates the affected prefix caches.

**Write reduction.** 5,000 submissions of (say) 200 distinct queries become a
handful of batch statements instead of 5,000 individual writes. `/stats` reports
`searchesAccepted`, `writeStatements`, and the `writeReductionRatio`.

**Failure trade-off.** The buffer lives in **Redis, not process memory**, so an
app crash does not lose un-flushed searches — they are drained on the next start.
Draining is `LRANGE` then `LTRIM` (not atomic), so a crash *between* them re-reads
the same items: **at-least-once** semantics, meaning a rare small over-count. For a
popularity ranking this is acceptable; the alternative (exactly-once via per-item
`LPOP`/transactions) costs more round-trips and complexity for no ranking benefit.

## 5. Trending / recency-aware ranking

Tracked in a Redis ZSET (`backend/src/services/trendingService.js`):

- **Tracking recent searches:** each `/search` does `ZINCRBY trending <TREND_BOOST>`.
- **Decay:** a background job multiplies every score by `DECAY_FACTOR` (0.95) every
  `DECAY_INTERVAL_MS` (10s), dropping members below ~0.01. A query's score therefore
  decays geometrically once searches stop.
- **Avoiding permanent over-ranking:** because of decay, a one-off spike fades within
  a minute or two — only *sustained* recent activity keeps a query near the top. This
  is the key difference from all-time count, which never forgets.
- **Blended ranking (enhanced `/suggest?mode=recency`):** candidates are over-fetched
  (limit×3) from Postgres, then scored:

  ```
  final = (1 − w)·popularity_norm + w·recency_norm        (w = RECENCY_WEIGHT, default 0.5)
  ```

  where `popularity_norm` and `recency_norm` are min-max normalized within the
  candidate set so the two signals are comparable. The same `/suggest` endpoint
  serves both modes — `?mode=basic` sorts purely by count, `?mode=recency` blends —
  so the difference is demonstrable side-by-side from the UI toggle or via curl.
- **Cache interaction:** recency rankings drift quickly, so recency-mode entries use
  a short TTL (10s) and are invalidated on batch flush. This is the freshness ↔
  latency ↔ complexity trade-off: shorter TTL = fresher but lower hit rate.

## 6. Latency & metrics

`backend/src/metrics/metrics.js` keeps in-process counters (cache hit/miss, DB
read/write, searches, write statements) and a rolling window of `/suggest`
latencies for p50/p95/p99. Exposed at `GET /stats`. `scripts/loadtest.js`
(autocannon) drives a realistic prefix mix; run cold vs warm to show the cache's
effect on p95.

## Performance

Sample run on the dev machine (150k-row synthetic dataset, 3 Redis nodes,
`autocannon`, 20 connections, 6s). Re-run `npm run loadtest` + `curl /stats` to
reproduce; numbers will vary by hardware.

| Metric | Warm cache |
|---|---|
| `/suggest` requests/sec | ~33,000 |
| `/suggest` p50 latency | 0.36 ms |
| `/suggest` p95 latency | 0.52 ms |
| `/suggest` p99 latency | 0.60 ms |
| Cache hit rate | 99.8% (198,405 hits / 365 misses) |
| DB reads (cold-prefix fallbacks) | 365 |

| Batch metric | Value |
|---|---|
| searchesAccepted | 36 |
| writeStatements | 2 |
| dbWrites (distinct rows) | 3 |
| writeReductionRatio | 18× (36 searches → 2 UPSERT statements) |

The hit rate climbs to ~99.8% under load because the prefix set is small and hot —
each prefix misses once (DB fallback), then every subsequent request is served from
Redis until the 60s TTL expires. The write-reduction ratio grows with traffic: the
busier the system, the more searches each batch statement absorbs.
