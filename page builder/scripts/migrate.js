const fs = require('fs');
const path = require('path');
const pool = require('../src/config/database');

(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const dir = path.join(__dirname, '..', 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('applied', f);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
