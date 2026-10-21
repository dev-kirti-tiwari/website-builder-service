import { Pool, type PoolClient } from 'pg';

export function createPool(connectionString: string, max: number): Pool {
  const pool = new Pool({ connectionString, max, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) =>
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: err.message })),
  );
  return pool;
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (err: unknown): boolean => (err as { code?: string })?.code === '23505';
