# Search Typeahead System

A search typeahead (autocomplete) system that suggests popular queries as you type,
records searches, and serves suggestions with low latency. Built for the HLD101
assignment (SST-2028).

- **Backend:** Node.js + Express
- **Primary store:** PostgreSQL
- **Cache:** multiple real Redis instances, routed by **consistent hashing**
- **Frontend:** React + Vite
- **Dataset:** AOL search query logs (with a synthetic fallback generator)

```
Browser (React) ──▶ Express ──▶ Redis cache (consistent-hash routed) ──▶ PostgreSQL
                         │
                         ├─ search buffer (Redis LIST) ──▶ BatchWriter ──▶ Postgres UPSERT
                         └─ trending ZSET (time-decayed)
```

See [docs/architecture.md](docs/architecture.md) for the full design and trade-offs.

---

## Prerequisites

- Node.js 20+
- Docker + Docker Compose

## 1. Start infrastructure (Postgres + 3 Redis nodes)

```bash
cp .env.example .env
docker compose up -d
```

This starts PostgreSQL on `5432` and three Redis nodes on `6379`, `6380`, `6381`
(the three logical cache nodes on the consistent-hash ring).

## 2. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

## 3. Load the dataset

**Option A — AOL logs (real data).** Download the AOL query collection
(`user-ct-test-collection-01.txt` … `-10.txt`, tab-separated:
`AnonID  Query  QueryTime  ItemRank  ClickURL`) into a `data/` directory at the
repo root, then:

```bash
cd backend
npm run ingest            # reads ../data/*.txt|*.gz, aggregates, COPYs into Postgres
# npm run ingest ../data 2   # optional: drop queries seen fewer than 2 times
```

**Option B — synthetic fallback (no download).** Generates 150k+ Zipf-distributed
queries so the project runs end-to-end immediately:

```bash
cd backend
npm run gen-synthetic     # loads ~150k rows into Postgres
```

Both paths target **100k+ distinct queries** (the assignment minimum).

## 4. Run

```bash
# terminal 1
cd backend && npm start          # http://localhost:4000

# terminal 2
cd frontend && npm run dev       # http://localhost:5173
```

Open http://localhost:5173, type, and watch suggestions appear. Toggle
**Basic** vs **Recency-aware** ranking to compare the two modes.

---

## API

| Method | Path | Description |
|---|---|---|
| GET | `/suggest?q=<prefix>&mode=basic\|recency` | Up to 10 prefix matches, sorted by score. `basic` = all-time count; `recency` = blended popularity + recency. |
| POST | `/search` `{ "query": "..." }` | Records the search (async, batched); returns `{ "message": "Searched" }`. |
| GET | `/trending?limit=10` | Top recency-ranked queries. |
| GET | `/cache/debug?prefix=<p>&mode=` | Which Redis node owns the prefix key + hit/miss + ring position. |
| GET | `/stats` | Cache hit rate, DB reads/writes, write-reduction ratio, p50/p95/p99 latency. |

### Examples

```bash
curl 'http://localhost:4000/suggest?q=ip'
curl -X POST http://localhost:4000/search -H 'Content-Type: application/json' -d '{"query":"new phone"}'
curl 'http://localhost:4000/cache/debug?prefix=ip'
curl 'http://localhost:4000/trending'
curl 'http://localhost:4000/stats'
```

---

## Performance report

Measure `/suggest` latency with the included load test. Run it twice — once cold,
once warm — to show the cache effect:

```bash
cd backend
npm run loadtest                       # default: localhost:4000, 10s, basic mode
node scripts/loadtest.js http://localhost:4000 10 recency
```

Then read the live counters:

```bash
curl 'http://localhost:4000/stats'
```

`/stats` reports:
- **cacheHitRate** — fraction of `/suggest` reads served from Redis.
- **dbReads / dbWrites** — Postgres prefix queries and rows written.
- **searchesAccepted vs writeStatements** + **writeReductionRatio** — how many
  search submissions collapsed into how few batch UPSERT statements.
- **latencyMs.p50 / p95 / p99** — `/suggest` latency percentiles.

Fill in your measured numbers in [docs/architecture.md](docs/architecture.md#performance).

### Consistent-hashing demo

```bash
curl 'http://localhost:4000/cache/debug?prefix=ip'    # miss, shows owning node
curl 'http://localhost:4000/suggest?q=ip'             # populates that node
curl 'http://localhost:4000/cache/debug?prefix=ip'    # hit, same node

docker stop typeahead-redis-1                          # remove a node
# re-run cache/debug for several prefixes: only keys on the arc near redis-1 remap.
```

---

## Project layout

```
backend/   Express API, services (suggest, search, batch writer, trending),
           consistent-hash cache, Postgres repo, scripts (ingest/synthetic/loadtest)
frontend/  Vite + React UI (search box, debounced suggestions, keyboard nav, trending)
docs/      architecture.md — design, scoring formula, trade-offs
```
