// Fallback dataset generator: produces 150k+ distinct queries with Zipf-distributed
// counts and bulk-loads them into Postgres via COPY. Lets the project run end-to-end
// without downloading the AOL logs. Usage: npm run gen-synthetic
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pool, ensureSchema, closePool } from '../src/db/pool.js';
import { normalize } from '../src/config.js';

const HEADS = [
  'iphone', 'ipad', 'macbook', 'samsung galaxy', 'google pixel', 'sony headphones',
  'nike shoes', 'adidas', 'laptop', 'gaming pc', 'mechanical keyboard', 'office chair',
  'coffee maker', 'air fryer', 'washing machine', 'java tutorial', 'python course',
  'react hooks', 'node js', 'docker compose', 'kubernetes', 'machine learning',
  'best movies', 'weather today', 'news', 'recipes', 'flights to', 'hotels in',
  'how to', 'what is', 'cheap', 'buy', 'used', 'review', 'price of', 'near me',
];
const TAILS = [
  '', ' pro', ' max', ' 15', ' 16', ' case', ' charger', ' deals', ' 2024', ' 2025',
  ' for sale', ' online', ' reviews', ' specs', ' vs', ' battery', ' screen', ' cheap',
  ' best', ' refurbished', ' accessories', ' manual', ' setup', ' price', ' india',
  ' usa', ' download', ' free', ' tutorial', ' beginners', ' advanced', ' guide',
];
const EXTRA = ['a', 'an', 'the', 'with', 'and', 'for', 'in', 'to', 'of', 'pro', 'mini', 'lite'];

function* generate(target) {
  const seen = new Set();
  let rank = 1;
  // Zipf: count ~ floor(BASE / rank^s). Popular heads get huge counts, long tail tiny.
  const BASE = 2_000_000;
  const s = 1.05;

  for (const head of HEADS) {
    for (const tail of TAILS) {
      let q = normalize(head + tail);
      if (!q || seen.has(q)) continue;
      seen.add(q);
      const count = Math.max(1, Math.floor(BASE / Math.pow(rank, s)));
      yield `${q}\t${count}\n`;
      rank++;
    }
  }

  // Pad with combinatorial long-tail queries until we exceed the target.
  let i = 0;
  while (seen.size < target) {
    const head = HEADS[i % HEADS.length];
    const tail = TAILS[(i * 7) % TAILS.length];
    const extra = EXTRA[(i * 3) % EXTRA.length];
    const n = (i % 5) + 1;
    const q = normalize(`${head}${tail} ${extra} ${n}`);
    i++;
    if (!q || seen.has(q)) continue;
    seen.add(q);
    const count = Math.max(1, Math.floor(BASE / Math.pow(rank, s)));
    yield `${q}\t${count}\n`;
    rank++;
  }
}

async function main() {
  const target = Number(process.argv[2] || 150_000);
  await ensureSchema();
  const client = await pool.connect();
  try {
    console.log(`[gen] truncating queries and generating ~${target} rows...`);
    await client.query('TRUNCATE queries');
    const stream = client.query(
      copyFrom('COPY queries (query_text, count) FROM STDIN WITH (FORMAT text)')
    );
    await pipeline(Readable.from(generate(target)), stream);
    const { rows } = await client.query('SELECT count(*)::int AS n, max(count) AS mx FROM queries');
    console.log(`[gen] done. rows=${rows[0].n}, max count=${rows[0].mx}`);
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
