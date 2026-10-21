import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, newPool, resetDb, seedPublishedForm } from '../helpers';

const pool = newPool();
const app = buildApp(pool);

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

const post = (formId: string | number, body: unknown, headers: Record<string, string> = {}, a = app) =>
  request(a).post(`/api/v1/public/forms/${formId}/submissions`).set(headers).send(body as object);

describe('public submission endpoint', () => {
  it('accepts an anonymous valid submission', async () => {
    const id = await seedPublishedForm(app);
    const res = await post(id, { data: { name: 'Ana', email: 'ana@example.com', topic: 'sales' } });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('submissionId');
    expect(Object.keys(res.body.data).sort()).toEqual(['receivedAt', 'submissionId']); // no internals leaked
  });

  it('rejects unknown form, invalid ids and non-JSON bodies', async () => {
    expect((await post(999, { data: {} })).status).toBe(404);
    expect((await post('abc', { data: {} })).status).toBe(400);
    const id = await seedPublishedForm(app);
    expect((await post(id, 'text')).status).toBe(400);
    expect((await post(id, {})).status).toBe(400);
    expect((await post(id, { data: [] })).status).toBe(400);
  });

  it.each([
    ['unknown field', { name: 'Ana', email: 'a@b.co', admin: true }],
    ['missing required', { name: 'Ana' }],
    ['wrong type', { name: 123, email: 'a@b.co' }],
    ['object injection', { name: { $gt: '' }, email: 'a@b.co' }],
    ['bad email', { name: 'Ana', email: 'not-an-email' }],
    ['value over limit', { name: 'x'.repeat(51), email: 'a@b.co' }],
    ['invalid select option', { name: 'Ana', email: 'a@b.co', topic: 'other' }],
    ['NUL character', { name: 'An\u0000a', email: 'a@b.co' }],
  ])('rejects %s with 400 and stores nothing', async (_n, data) => {
    const id = await seedPublishedForm(app);
    const res = await post(id, { data });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM form_submissions')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM outbox_events')).rows[0].n).toBe(0);
  });

  it('rejects oversized bodies with 413', async () => {
    const id = await seedPublishedForm(app);
    const res = await post(id, { data: { name: 'x'.repeat(200_000), email: 'a@b.co' } });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects honeypot spam', async () => {
    const id = await seedPublishedForm(app);
    const res = await post(id, { data: { name: 'Bot', email: 'a@b.co' }, honeypot: 'http://spam' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SPAM_DETECTED');
  });

  it('rate limits abusive callers with 429', async () => {
    const limited = buildApp(pool, { PUBLIC_RATE_LIMIT_MAX: '3' });
    const id = await seedPublishedForm(limited);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(id, { data: { name: 'Ana', email: 'a@b.co' } }, {}, limited)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const blocked = await post(id, { data: {} }, {}, limited);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not require or accept a user JWT identity', async () => {
    const id = await seedPublishedForm(app);
    const res = await post(id, { data: { name: 'Ana', email: 'a@b.co' } }, { Authorization: 'Bearer garbage' });
    expect(res.status).toBe(200);
    expect((await pool.query('SELECT user_id FROM form_submissions')).rows[0].user_id).toBeNull();
  });

  describe('idempotency', () => {
    it('replays the same response for the same key + payload and stores once', async () => {
      const id = await seedPublishedForm(app);
      const key = { 'Idempotency-Key': 'key-abcdef-1' };
      const body = { data: { name: 'Ana', email: 'a@b.co' } };
      const a = await post(id, body, key);
      const b = await post(id, body, key);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(b.body.data.submissionId).toBe(a.body.data.submissionId);
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM form_submissions')).rows[0].n).toBe(1);
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM outbox_events')).rows[0].n).toBe(1);
    });
    it('rejects the same key with a different payload (409) and malformed keys (400)', async () => {
      const id = await seedPublishedForm(app);
      const key = { 'Idempotency-Key': 'key-abcdef-2' };
      await post(id, { data: { name: 'Ana', email: 'a@b.co' } }, key);
      expect((await post(id, { data: { name: 'Bob', email: 'a@b.co' } }, key)).status).toBe(409);
      expect((await post(id, { data: { name: 'Ana', email: 'a@b.co' } }, { 'Idempotency-Key': 'short' })).status).toBe(400);
    });
    it('handles concurrent requests with the same key', async () => {
      const id = await seedPublishedForm(app);
      const key = { 'Idempotency-Key': 'key-concurrent-3' };
      const body = { data: { name: 'Ana', email: 'a@b.co' } };
      const results = await Promise.all([post(id, body, key), post(id, body, key), post(id, body, key)]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((r) => r.body.data.submissionId)).size).toBe(1);
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM form_submissions')).rows[0].n).toBe(1);
    });
  });
});
