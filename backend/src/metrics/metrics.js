// Lightweight in-process metrics: counters + a latency ring buffer for percentiles.
// Reset on restart — sufficient for the assignment's performance report.

const counters = {
  cacheHit: 0,
  cacheMiss: 0,
  dbReads: 0,       // prefix queries served from Postgres
  dbWrites: 0,      // rows written via UPSERT
  writeStatements: 0, // number of batch UPSERT statements executed
  searchesAccepted: 0, // /search submissions enqueued
};

const CAP = 5000;
const suggestLatencies = []; // rolling window of /suggest latencies (ms)

export const metrics = {
  inc(name, by = 1) {
    if (name in counters) counters[name] += by;
  },

  recordSuggestLatency(ms) {
    suggestLatencies.push(ms);
    if (suggestLatencies.length > CAP) suggestLatencies.shift();
  },

  percentile(p) {
    if (suggestLatencies.length === 0) return 0;
    const sorted = [...suggestLatencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Number(sorted[idx].toFixed(3));
  },

  snapshot() {
    const totalReads = counters.cacheHit + counters.cacheMiss;
    const hitRate = totalReads === 0 ? 0 : counters.cacheHit / totalReads;
    return {
      ...counters,
      cacheHitRate: Number(hitRate.toFixed(4)),
      suggestSamples: suggestLatencies.length,
      latencyMs: {
        p50: this.percentile(50),
        p95: this.percentile(95),
        p99: this.percentile(99),
      },
      // Write-reduction: how many searches collapsed into how few statements.
      writeReductionRatio:
        counters.writeStatements === 0
          ? 0
          : Number((counters.searchesAccepted / counters.writeStatements).toFixed(2)),
    };
  },
};
