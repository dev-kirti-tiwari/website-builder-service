const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// pg returns BIGINT as strings by default, which preserves precision (never converted to Number).
const pool = new Pool({ connectionString: config.databaseUrl });

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
  for (let i = 0; ; i++) {
    try {
      const c = await pool.connect();
      try {
        await c.query('SELECT pg_advisory_lock(424242)');
        await c.query(sql);
        await c.query('SELECT pg_advisory_unlock(424242)');
      } finally {
        c.release();
      }
      return;
    } catch (e) {
      if (i >= 20) throw e;
      console.log('Waiting for database...', e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// Demo data standing in for the Website service. Ids deliberately exceed 2^53 to prove BIGINT exactness.
async function seed() {
  const w = (id, t, o, name) => q(
    'INSERT INTO wb_websites (id,tenant_id,organization_id,name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [id, t, o, name]);
  const r = (id, website, content) => q(
    'INSERT INTO wb_revisions (id,website_id,content) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [id, website, JSON.stringify(content)]);
  const page = (route, title) => ({ route, title });
  await w('9007199254740993', 1001, 2001, 'Demo site');
  await w('9007199254740998', 1001, 2002, 'Other org site');
  await w('9007199254740999', 1002, 3001, 'Other tenant site');
  await r('9007199254740995', '9007199254740993', { pages: [page('/', 'Home'), page('/about', 'About')], assets: ['logo.png'] });
  await r('9007199254740996', '9007199254740993', { pages: [page('/', 'Home'), page('/', 'Duplicate')], assets: ['missing:hero.png'] });
  await r('9007199254740997', '9007199254740993', { pages: [page('/', 'Home')], simulateFailure: 'deploy' });
  await r('9007199254741001', '9007199254740993', { pages: [page('/', 'Home v2'), page('/contact', 'Contact')], assets: [] });
  await r('9007199254741004', '9007199254740993', { pages: [page('/', 'Home v3')], simulateFailure: 'propagate' });
  await r('9007199254741002', '9007199254740998', { pages: [page('/', 'Other org home')] });
  await r('9007199254741003', '9007199254740999', { pages: [page('/', 'Other tenant home')] });
}

module.exports = { pool, q, tx, migrate, seed };
