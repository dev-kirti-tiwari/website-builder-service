import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { A, bearer, buildApp, createForm, newPool, resetDb, seedPublishedForm } from '../helpers';

const pool = newPool();
const app = buildApp(pool);

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

describe('CORS', () => {
  const ui = 'http://localhost:5173';
  const cors = buildApp(pool, { CORS_ORIGINS: `${ui}, https://builder.example.com` });

  it('is disabled by default (no CORS headers)', async () => {
    const res = await request(app).get('/health').set('Origin', ui);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('answers a preflight for an allowed origin without authentication', async () => {
    const res = await request(cors)
      .options('/api/v1/websites/5/forms')
      .set({ Origin: ui, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ui);
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
  });
  it('adds the header on real protected and public responses for allowed origins only', async () => {
    const ok = await request(cors).get('/api/v1/websites/5/forms').set({ ...bearer(A), Origin: ui });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(ui);
    const denied = await request(cors).get('/api/v1/websites/5/forms').set({ ...bearer(A), Origin: 'http://evil.example' });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const id = await seedPublishedForm(cors);
    const pub = await request(cors).post(`/api/v1/public/forms/${id}/submissions`).set('Origin', ui).send({ data: { name: 'Ana', email: 'a@b.co' } });
    expect(pub.status).toBe(200);
    expect(pub.headers['access-control-allow-origin']).toBe(ui);
  });
});

describe('edge cases', () => {
  it('can clear a form description with null and leave it untouched when omitted', async () => {
    const form = await createForm(app, A, { name: 'Desc', description: 'hello' });
    const kept = await request(app).patch(`/api/v1/forms/${form.id}`).set(bearer(A)).send({ name: 'Desc 2' });
    expect(kept.body.data.description).toBe('hello');
    const cleared = await request(app).patch(`/api/v1/forms/${form.id}`).set(bearer(A)).send({ description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.description).toBeNull();
  });

  it('concurrent publishes produce distinct, sequential versions', async () => {
    const id = await seedPublishedForm(app);
    const results = await Promise.all([1, 2, 3].map(() => request(app).post(`/api/v1/forms/${id}/publish`).set(bearer(A))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.map((r) => r.body.data.versionNumber).sort()).toEqual([2, 3, 4]);
  });

  it('returns an empty page (not an error) beyond the last page', async () => {
    await createForm(app);
    const res = await request(app).get('/api/v1/websites/5/forms?page=50&limit=10').set(bearer(A));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ items: [], pagination: { page: 50, limit: 10, total: 1 } });
  });

  it('rejects an empty PATCH and a field update with no properties', async () => {
    const form = await createForm(app);
    expect((await request(app).patch(`/api/v1/forms/${form.id}`).set(bearer(A)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/v1/forms/${form.id}`).set(bearer(A)).send({ revision: 1 })).status).toBe(400);
  });

  it('keeps a submitted checkbox=false and number=0 (falsy values are not "empty")', async () => {
    const form = await createForm(app);
    await request(app).post(`/api/v1/forms/${form.id}/fields`).set(bearer(A)).send({ name: 'agree', label: 'Agree', type: 'checkbox', required: true });
    await request(app).post(`/api/v1/forms/${form.id}/fields`).set(bearer(A)).send({ name: 'qty', label: 'Qty', type: 'number', required: true, validation: { min: 0 } });
    await request(app).post(`/api/v1/forms/${form.id}/publish`).set(bearer(A));
    const res = await request(app).post(`/api/v1/public/forms/${form.id}/submissions`).send({ data: { agree: false, qty: 0 } });
    expect(res.status).toBe(200);
    const row = (await pool.query('SELECT data FROM form_submissions')).rows[0];
    expect(row.data).toEqual({ agree: false, qty: 0 });
  });

  it('handles a website id near the BIGINT limit without a 500', async () => {
    const res = await request(app).get('/api/v1/websites/999999999999999999/forms').set(bearer(A));
    expect(res.status).toBe(200);
  });
});
