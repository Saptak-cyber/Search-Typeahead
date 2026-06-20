// Latency load test for GET /suggest. Hits a realistic mix of short prefixes and
// reports p50/p95/p99 + throughput. Run twice (cold then warm cache) to show the
// cache's effect. Usage: node scripts/loadtest.js [baseUrl] [durationSec] [mode]
import autocannon from 'autocannon';

const base = process.argv[2] || 'http://localhost:4000';
const duration = Number(process.argv[3] || 10);
const mode = process.argv[4] || 'basic';

// Spread requests across many prefixes so we exercise different ring nodes.
const prefixes = ['i', 'ip', 'iph', 'sa', 'sam', 'go', 'goo', 'ja', 'jav', 'py',
  're', 'no', 'doc', 'be', 'how', 'wh', 'che', 'bu', 'ne', 'co'];

const requests = prefixes.map((p) => ({
  method: 'GET',
  path: `/suggest?q=${encodeURIComponent(p)}&mode=${mode}`,
}));

console.log(`[loadtest] ${base} for ${duration}s, mode=${mode}, ${prefixes.length} prefixes`);

const instance = autocannon(
  { url: base, connections: 20, duration, requests },
  (err, result) => {
    if (err) { console.error(err); process.exit(1); }
    console.log('\n=== Results ===');
    console.log(`Requests/sec : ${result.requests.average.toFixed(0)}`);
    console.log(`Latency p50  : ${result.latency.p50} ms`);
    console.log(`Latency p95  : ${result.latency.p97_5} ms (p97.5)`);
    console.log(`Latency p99  : ${result.latency.p99} ms`);
    console.log(`Latency max  : ${result.latency.max} ms`);
    console.log(`Total 2xx    : ${result['2xx']}`);
  }
);
autocannon.track(instance, { renderProgressBar: true });
