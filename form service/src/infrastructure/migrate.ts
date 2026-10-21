import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';

function findMigrationsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'migrations');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('migrations directory not found');
}

const MIGRATIONS_DIR = findMigrationsDir();
const LOCK_ID = 727001;

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
