// Ingest the AOL search query logs into Postgres.
//
// AOL files (user-ct-test-collection-*.txt[.gz]) are TAB-separated with a header:
//   AnonID \t Query \t QueryTime \t ItemRank \t ClickURL
// We stream every file in the data dir, normalize the Query column, aggregate a
// count per distinct query, drop queries appearing fewer than MIN_COUNT times, and
// COPY the result into Postgres. Usage:
//   node scripts/ingest.js [dataDir=../data] [minCount=1]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pool, ensureSchema, closePool } from '../src/db/pool.js';
import { normalize } from '../src/config.js';

const dataDir = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../data'));
const MIN_COUNT = Number(process.argv[3] || 1);

function openLineStream(file) {
  const raw = fs.createReadStream(file);
  const input = file.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
  return readline.createInterface({ input, crlfDelay: Infinity });
}

async function main() {
  if (!fs.existsSync(dataDir)) {
    console.error(`[ingest] data dir not found: ${dataDir}`);
    console.error('Download the AOL logs there, or run: npm run gen-synthetic');
    process.exit(1);
  }
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.txt') || f.endsWith('.gz'))
    .map((f) => path.join(dataDir, f));
  if (files.length === 0) {
    console.error(`[ingest] no .txt/.gz files in ${dataDir}. Try: npm run gen-synthetic`);
    process.exit(1);
  }

  const counts = new Map();
  let lines = 0;
  for (const file of files) {
    console.log(`[ingest] reading ${path.basename(file)}...`);
    let header = true;
    for await (const line of openLineStream(file)) {
      if (header) { header = false; continue; } // skip column header
      const cols = line.split('\t');
      const q = normalize(cols[1]); // Query column
      if (!q || q === '-') continue;
      counts.set(q, (counts.get(q) ?? 0) + 1);
      if (++lines % 1_000_000 === 0) console.log(`[ingest] ${lines} lines, ${counts.size} distinct`);
    }
  }
  console.log(`[ingest] total ${lines} lines -> ${counts.size} distinct queries`);

  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('TRUNCATE queries');
    const stream = client.query(
      copyFrom('COPY queries (query_text, count) FROM STDIN WITH (FORMAT text)')
    );
    function* rows() {
      for (const [q, c] of counts) {
        if (c < MIN_COUNT) continue;
        // Escape tab/newline/backslash for COPY text format.
        const safe = q.replace(/\\/g, '\\\\').replace(/\t/g, ' ').replace(/\n/g, ' ');
        yield `${safe}\t${c}\n`;
      }
    }
    await pipeline(Readable.from(rows()), stream);
    const { rows: r } = await client.query('SELECT count(*)::int AS n, max(count) AS mx FROM queries');
    console.log(`[ingest] loaded rows=${r[0].n}, max count=${r[0].mx}`);
    if (r[0].n < 100_000) {
      console.warn(`[ingest] WARNING: ${r[0].n} < 100k. Lower minCount or add more AOL files.`);
    }
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
