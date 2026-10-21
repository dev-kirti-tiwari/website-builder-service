import { Pool } from 'pg';
import { runMigrations } from '../src/infrastructure/migrate';

const url =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/form_api_test';

export default async function setup() {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const adminPool = new Pool({ connectionString: admin.toString() });
  const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await adminPool.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await adminPool.end();

  const pool = new Pool({ connectionString: url });
  await runMigrations(pool);
  await pool.end();
}
