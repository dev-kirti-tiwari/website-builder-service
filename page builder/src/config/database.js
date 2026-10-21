const { Pool, types } = require('pg');
const env = require('./env');

// Return BIGINT (oid 20) as string so IDs serialize as JSON strings.
types.setTypeParser(20, (v) => v);

const pool = new Pool({ connectionString: env.databaseUrl });

pool.withTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

module.exports = pool;
