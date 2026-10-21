'use strict';

const { Pool } = require('pg');

function createPool(config, logger) {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => logger.error({ err: { message: err.message } }, 'Unexpected idle PG client error'));
  return pool;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
