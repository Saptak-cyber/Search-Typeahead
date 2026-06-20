import { pool } from './pool.js';
import { config } from '../config.js';
import { metrics } from '../metrics/metrics.js';

// LIKE needs the wildcard's literal metacharacters escaped so a user typing
// "50%" or "a_b" doesn't accidentally widen the prefix match.
function escapeLike(prefix) {
  return prefix.replace(/([\\%_])/g, '\\$1');
}

// Top-N queries matching `prefix`, sorted by all-time count. Primary-store fallback
// for the suggestion flow (used on cache miss).
export async function prefixSearch(prefix, limit = config.suggestLimit) {
  const pattern = `${escapeLike(prefix)}%`;
  const { rows } = await pool.query(
    `SELECT query_text, count
       FROM queries
      WHERE query_text LIKE $1
      ORDER BY count DESC
      LIMIT $2`,
    [pattern, limit]
  );
  metrics.inc('dbReads');
  return rows.map((r) => ({ query: r.query_text, count: Number(r.count) }));
}

// Aggregated batch write: one multi-row statement that inserts new queries and
// increments existing ones. `deltas` is a Map<query, countDelta>.
export async function bulkUpsert(deltas) {
  const entries = [...deltas.entries()];
  if (entries.length === 0) return 0;

  const values = [];
  const params = [];
  entries.forEach(([query, delta], i) => {
    params.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    values.push(query, delta);
  });

  await pool.query(
    `INSERT INTO queries (query_text, count)
     VALUES ${params.join(', ')}
     ON CONFLICT (query_text)
     DO UPDATE SET count = queries.count + EXCLUDED.count, updated_at = now()`,
    values
  );

  metrics.inc('writeStatements');
  metrics.inc('dbWrites', entries.length);
  return entries.length;
}

export async function countRows() {
  const { rows } = await pool.query('SELECT count(*)::bigint AS n FROM queries');
  return Number(rows[0].n);
}
