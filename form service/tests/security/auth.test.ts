import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { A, AUDIENCE, INTERNAL_TOKEN, ISSUER, SECRET, bearer, buildApp, createForm, newPool, resetDb, token } from '../helpers';

const pool = newPool();
const app = buildApp(pool);
const gateway = buildApp(pool, { AUTH_MODE: 'gateway-context' });

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

const get = (headers: Record<string, string>, a = app) => request(a).get('/api/v1/websites/5/forms').set(headers);

describe('direct-jwt authentication', () => {
  it('rejects a missing or malformed Authorization header with 401', async () => {
    expect((await get({})).status).toBe(401);
    expect((await get({ Authorization: 'Basic abc' })).status).toBe(401);
    expect((await get({ Authorization: 'Bearer' })).status).toBe(401);
    expect((await get({ Authorization: 'Bearer not.a.jwt' })).status).toBe(401);
  });
  it('rejects expired, not-yet-valid, wrong audience, wrong issuer and wrong signature', async () => {
    const h = (t: string) => ({ Authorization: `Bearer ${t}` });
    expect((await get(h(token({}, { expiresIn: -60 })))).status).toBe(401);
    expect((await get(h(token({}, { notBefore: 600 })))).status).toBe(401);
    expect((await get(h(token({}, { audience: 'other' })))).status).toBe(401);
    expect((await get(h(token({}, { issuer: 'other' })))).status).toBe(401);
    expect((await get(h(jwt.sign({ tenant_id: '1', organization_id: '10', roles: ['form_admin'] }, 'x'.repeat(40), { subject: '100', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' })))).status).toBe(401);
  });
  it('rejects alg=none and algorithms outside the allow-list', async () => {
    const none = jwt.sign({ tenant_id: '1', organization_id: '10', roles: ['form_admin'], sub: '100', iss: ISSUER, aud: AUDIENCE }, '', { algorithm: 'none' as never });
    expect((await get({ Authorization: `Bearer ${none}` })).status).toBe(401);
    const hs512 = jwt.sign({ tenant_id: '1', organization_id: '10', roles: ['form_admin'] }, SECRET, { algorithm: 'HS512', subject: '100', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' });
    expect((await get({ Authorization: `Bearer ${hs512}` })).status).toBe(401);
  });
  it('rejects tokens missing required claims or with non-numeric ids', async () => {
    const sign = (claims: object, sub?: string) =>
      jwt.sign(claims, SECRET, { ...(sub ? { subject: sub } : {}), issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' });
    expect((await get({ Authorization: `Bearer ${sign({ organization_id: '10' }, '100')}` })).status).toBe(401);
    expect((await get({ Authorization: `Bearer ${sign({ tenant_id: '1', organization_id: '10' })}` })).status).toBe(401);
    expect((await get({ Authorization: `Bearer ${sign({ tenant_id: '1 OR 1=1', organization_id: '10' }, '100')}` })).status).toBe(401);
  });
  it('accepts a valid token', async () => {
    expect((await get(bearer(A))).status).toBe(200);
  });
  it('never trusts spoofed context headers (mismatch -> 403, matching -> ok)', async () => {
    const t = bearer(A);
    expect((await get({ ...t, 'X-Tenant-Id': '2' })).status).toBe(403);
    expect((await get({ ...t, 'X-Organization-Id': '99' })).status).toBe(403);
    expect((await get({ ...t, 'X-User-Id': '1' })).body.error.code).toBe('CONTEXT_MISMATCH');
    expect((await get({ ...t, 'X-Tenant-Id': '1', 'X-Organization-Id': '10', 'X-User-Id': '100', 'X-Software-Id': 'website-builder', 'X-Request-Id': 'abc-123' })).status).toBe(200);
  });
  it('creator id comes from the verified token, not from the body or headers', async () => {
    const res = await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).send({ name: 'X' });
    expect(res.body.data.createdBy).toBe('100');
    const spoof = await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).send({ name: 'Y', createdBy: '1', tenant_id: '2' });
    expect(spoof.status).toBe(400);
  });
});

describe('authorization (RBAC)', () => {
  it('viewer can read but not write; editor cannot publish/delete; unknown role gets nothing', async () => {
    const form = await createForm(app);
    const viewer = bearer({ ...A, roles: ['form_viewer'] });
    const editor = bearer({ ...A, roles: ['form_editor'] });
    expect((await request(app).get(`/api/v1/forms/${form.id}`).set(viewer)).status).toBe(200);
    expect((await request(app).post('/api/v1/websites/5/forms').set(viewer).send({ name: 'n' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/forms/${form.id}`).set(viewer).send({ name: 'n' })).status).toBe(403);
    expect((await request(app).post('/api/v1/websites/5/forms').set(editor).send({ name: 'Editor form' })).status).toBe(200);
    expect((await request(app).post(`/api/v1/forms/${form.id}/publish`).set(editor)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/forms/${form.id}`).set(editor)).status).toBe(403);
    expect((await request(app).post(`/api/v1/forms/${form.id}/automations`).set(editor).send({ actionType: 'notification', config: { templateKey: 'x' } })).status).toBe(403);
    expect((await request(app).get('/api/v1/websites/5/forms').set(bearer({ ...A, roles: ['nobody'] }))).status).toBe(403);
    expect((await request(app).get('/api/v1/websites/5/forms').set(bearer({ ...A, roles: [] }))).status).toBe(403);
  });
});

describe('gateway-context authentication', () => {
  const ctx = { 'X-Tenant-Id': '1', 'X-Organization-Id': '10', 'X-User-Id': '100', 'X-User-Roles': 'form_admin' };
  const svc = { Authorization: `Bearer ${INTERNAL_TOKEN}` };

  it('requires the internal service credential', async () => {
    expect((await get({ ...ctx }, gateway)).status).toBe(401);
    expect((await get({ ...ctx, Authorization: 'Bearer wrong-token-wrong-token-wrong-token-1' }, gateway)).status).toBe(401);
    expect((await get({ ...ctx, ...bearer(A) }, gateway)).status).toBe(401); // a user JWT is not a service credential
  });
  it('requires numeric trusted context headers', async () => {
    expect((await get({ ...svc }, gateway)).status).toBe(400);
    expect((await get({ ...svc, ...ctx, 'X-Tenant-Id': '1; DROP TABLE forms' }, gateway)).status).toBe(400);
  });
  it('uses the injected context and records the actor', async () => {
    const res = await request(gateway).post('/api/v1/websites/5/forms').set({ ...svc, ...ctx }).send({ name: 'Via gateway' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ createdBy: '100', tenantId: '1', organizationId: '10' });
    expect((await get({ ...svc, ...ctx, 'X-User-Roles': 'form_viewer' }, gateway)).status).toBe(200);
    expect((await request(gateway).post('/api/v1/websites/5/forms').set({ ...svc, ...ctx, 'X-User-Roles': 'form_viewer' }).send({ name: 'z' })).status).toBe(403);
  });
  it('public submissions still need no credential in gateway mode', async () => {
    expect((await request(gateway).post('/api/v1/public/forms/1/submissions').send({ data: {} })).status).toBe(404);
  });
});

describe('request ids', () => {
  it('propagates a safe X-Request-Id and replaces an unsafe one', async () => {
    const ok = await get({ ...bearer(A), 'X-Request-Id': 'trace-42' });
    expect(ok.headers['x-request-id']).toBe('trace-42');
    expect(ok.body.meta.requestId).toBe('trace-42');
    const bad = await get({ ...bearer(A), 'X-Request-Id': 'bad id\twith spaces' });
    expect(bad.body.meta.requestId).toMatch(/^req_/);
  });
});
