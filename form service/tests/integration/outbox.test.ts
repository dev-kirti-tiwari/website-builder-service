import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueOutbox, processOutboxBatch } from '../../src/infrastructure/outbox/repository';
import { withTransaction } from '../../src/infrastructure/postgres';
import { buildApp, newPool, resetDb, seedPublishedForm } from '../helpers';

const pool = newPool();
const app = buildApp(pool);
const scope = { tenantId: '1', organizationId: '10' };

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

describe('transactional outbox', () => {
  it('rolls back the event together with the business write', async () => {
    await expect(
      withTransaction(pool, async (db) => {
        await enqueueOutbox(db, scope, 'test.event', { a: 1 }, 'req_x');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM outbox_events')).rows[0].n).toBe(0);
  });

  it('processes a submission event and marks it processed', async () => {
    const id = await seedPublishedForm(app);
    await request(app).post(`/api/v1/public/forms/${id}/submissions`).send({ data: { name: 'Ana', email: 'a@b.co' } });
    const seen: string[] = [];
    const r = await processOutboxBatch(pool, async (e) => { seen.push(`${e.eventType}:${e.tenantId}`); });
    expect(r).toEqual({ processed: 1, retried: 0, dead: 0 });
    expect(seen).toEqual(['form.submission.created:1']);
    expect((await pool.query('SELECT status, attempts FROM outbox_events')).rows[0]).toEqual({ status: 'processed', attempts: 1 });
    expect(await processOutboxBatch(pool, async () => undefined)).toEqual({ processed: 0, retried: 0, dead: 0 });
  });

  it('retries with backoff and dead-letters after max attempts', async () => {
    await enqueueOutbox(pool, scope, 'test.event', {}, 'req_y');
    const fail = async () => { throw new Error('downstream 503'); };

    expect(await processOutboxBatch(pool, fail, { maxAttempts: 3, baseDelaySeconds: 60 })).toEqual({ processed: 0, retried: 1, dead: 0 });
    let row = (await pool.query(`SELECT status, attempts, last_error, next_attempt_at > NOW() AS delayed FROM outbox_events`)).rows[0];
    expect(row).toEqual({ status: 'pending', attempts: 1, last_error: 'downstream 503', delayed: true });
    // not due yet -> not picked up
    expect(await processOutboxBatch(pool, fail, { maxAttempts: 3 })).toEqual({ processed: 0, retried: 0, dead: 0 });

    for (const expected of [{ retried: 1, dead: 0 }, { retried: 0, dead: 1 }]) {
      await pool.query(`UPDATE outbox_events SET next_attempt_at = NOW() - interval '1 second'`);
      expect(await processOutboxBatch(pool, fail, { maxAttempts: 3, baseDelaySeconds: 60 })).toMatchObject(expected);
    }
    row = (await pool.query('SELECT status, attempts FROM outbox_events')).rows[0];
    expect(row).toEqual({ status: 'dead', attempts: 3 });
  });
});
