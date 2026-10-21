import type { Pool, PoolClient } from 'pg';

export async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
export const isCheckViolation = (e: unknown) => (e as { code?: string })?.code === '23514';
