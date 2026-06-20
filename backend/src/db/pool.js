import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({ connectionString: config.pgUrl, max: 10 });

// Apply schema.sql (idempotent). Called once on server / script startup.
export async function ensureSchema() {
  const sql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function closePool() {
  await pool.end();
}
