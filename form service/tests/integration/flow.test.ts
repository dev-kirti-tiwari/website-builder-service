import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { A, addField, bearer, buildApp, createForm, newPool, resetDb, seedPublishedForm } from '../helpers';

const pool = newPool();
const app = buildApp(pool);

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

describe('create -> edit -> publish -> public submit -> manage (every success is 200)', () => {
  it('runs the whole lifecycle', async () => {
    // create form
    const created = await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).send({ name: 'Contact us', description: 'Say hi' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ success: true, message: 'Form created' });
    expect(created.body.meta.requestId).toMatch(/^req_/);
    const formId: string = created.body.data.id;
    expect(created.body.data).toMatchObject({ slug: 'contact-us', status: 'draft', createdBy: '100', tenantId: '1', organizationId: '10', revision: 1 });

    // list + get
    const list = await request(app).get('/api/v1/websites/5/forms').set(bearer(A));
    expect(list.status).toBe(200);
    expect(list.body.data.pagination).toEqual({ page: 1, limit: 20, total: 1 });

    // fields
    const f1 = await request(app).post(`/api/v1/forms/${formId}/fields`).set(bearer(A)).send({ name: 'email', label: 'Email', type: 'email', required: true });
    expect(f1.status).toBe(200);
    const f2 = await request(app).post(`/api/v1/forms/${formId}/fields`).set(bearer(A)).send({ name: 'message', label: 'Message', type: 'textarea' });
    expect(f2.body.data.position).toBe(1);
    const upd = await request(app).patch(`/api/v1/forms/${formId}/fields/${f2.body.data.id}`).set(bearer(A)).send({ label: 'Your message', required: true });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ label: 'Your message', required: true, updatedBy: '100' });

    const got = await request(app).get(`/api/v1/forms/${formId}`).set(bearer(A));
    expect(got.status).toBe(200);
    expect(got.body.data.fields).toHaveLength(2);

    // update form with revision
    const patched = await request(app).patch(`/api/v1/forms/${formId}`).set(bearer(A)).send({ name: 'Contact', revision: 1 });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ name: 'Contact', revision: 2, updatedBy: '100' });
    const stale = await request(app).patch(`/api/v1/forms/${formId}`).set(bearer(A)).send({ name: 'Again', revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');

    // automation
    const auto = await request(app).post(`/api/v1/forms/${formId}/automations`).set(bearer(A)).send({ actionType: 'email', config: { templateKey: 'thank-you', recipientField: 'email' } });
    expect(auto.status).toBe(200);
    const autos = await request(app).get(`/api/v1/forms/${formId}/automations`).set(bearer(A));
    expect(autos.body.data).toHaveLength(1);

    // public submit is rejected before publish
    const early = await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { email: 'a@b.co', message: 'hi' } });
    expect(early.status).toBe(404);

    // publish
    const pub = await request(app).post(`/api/v1/forms/${formId}/publish`).set(bearer(A));
    expect(pub.status).toBe(200);
    expect(pub.body.data.versionNumber).toBe(1);

    // anonymous public submit (no Authorization header)
    const sub = await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { email: 'a@b.co', message: 'hi' } });
    expect(sub.status).toBe(200);
    const submissionId: string = sub.body.data.submissionId;

    // submission persisted anonymously, with outbox + audit in the DB
    const row = (await pool.query('SELECT * FROM form_submissions WHERE id = $1', [submissionId])).rows[0];
    expect(row).toMatchObject({ actor_type: 'ANONYMOUS_VISITOR', user_id: null, tenant_id: '1', organization_id: '10', schema_version_id: pub.body.data.versionId });
    const outbox = (await pool.query('SELECT * FROM outbox_events')).rows;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ event_type: 'form.submission.created', status: 'pending', tenant_id: '1' });
    expect(outbox[0].request_id).toBe(row.request_id);
    const audit = (await pool.query('SELECT action, actor_type, actor_id FROM audit_events ORDER BY id')).rows.map((r) => `${r.action}:${r.actor_type}:${r.actor_id}`);
    expect(audit).toContain('form.create:USER:100');
    expect(audit).toContain('form.publish:USER:100');
    expect(audit).toContain('submission.create:ANONYMOUS_VISITOR:null');

    // manage submissions
    const subs = await request(app).get(`/api/v1/forms/${formId}/submissions`).set(bearer(A));
    expect(subs.status).toBe(200);
    expect(subs.body.data.items).toHaveLength(1);
    const one = await request(app).get(`/api/v1/forms/${formId}/submissions/${submissionId}`).set(bearer(A));
    expect(one.status).toBe(200);
    expect(one.body.data.data).toEqual({ email: 'a@b.co', message: 'hi' });
    const mod = await request(app).patch(`/api/v1/forms/${formId}/submissions/${submissionId}`).set(bearer(A)).send({ status: 'read', metadata: { note: 'called back' } });
    expect(mod.status).toBe(200);
    expect(mod.body.data).toMatchObject({ status: 'read', metadata: { note: 'called back' }, updatedBy: '100' });
    const filtered = await request(app).get(`/api/v1/forms/${formId}/submissions?status=new`).set(bearer(A));
    expect(filtered.body.data.items).toHaveLength(0);

    // delete
    const del = await request(app).delete(`/api/v1/forms/${formId}`).set(bearer(A));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/v1/forms/${formId}`).set(bearer(A))).status).toBe(404);
    expect((await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { email: 'a@b.co', message: 'x' } })).status).toBe(404);
  });

  it('keeps published schema immutable: later draft edits do not affect public validation until republish', async () => {
    const formId = await seedPublishedForm(app);
    await addField(app, formId, { name: 'phone', label: 'Phone', type: 'phone', required: true });
    const still = await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { name: 'Ana', email: 'a@b.co' } });
    expect(still.status).toBe(200);
    const unknown = await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { name: 'Ana', email: 'a@b.co', phone: '123456' } });
    expect(unknown.status).toBe(400);

    const repub = await request(app).post(`/api/v1/forms/${formId}/publish`).set(bearer(A));
    expect(repub.body.data.versionNumber).toBe(2);
    const now = await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { name: 'Ana', email: 'a@b.co' } });
    expect(now.status).toBe(400);

    await expect(pool.query('UPDATE form_schema_versions SET schema = $1', ['{}'])).rejects.toThrow(/immutable/);
    await expect(pool.query('DELETE FROM form_schema_versions')).rejects.toThrow(/immutable/);
  });

  it('rejects publishing an empty form, duplicate slugs and duplicate fields', async () => {
    const form = await createForm(app);
    const empty = await request(app).post(`/api/v1/forms/${form.id}/publish`).set(bearer(A));
    expect(empty.status).toBe(400);
    const dup = await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).send({ name: 'Contact us' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SLUG_CONFLICT');
    await addField(app, form.id, { name: 'a', label: 'A', type: 'text' });
    const dupField = await request(app).post(`/api/v1/forms/${form.id}/fields`).set(bearer(A)).send({ name: 'a', label: 'A', type: 'text' });
    expect(dupField.status).toBe(409);
  });

  it('validates request bodies and ids', async () => {
    expect((await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).send({ name: 'x', tenantId: '9' })).status).toBe(400);
    expect((await request(app).get('/api/v1/forms/abc').set(bearer(A))).body.error.code).toBe('INVALID_ID');
    expect((await request(app).get('/api/v1/forms/99999999999999999999').set(bearer(A))).status).toBe(400);
    expect((await request(app).get('/api/v1/websites/5/forms?limit=1000').set(bearer(A))).status).toBe(400);
    const form = await createForm(app);
    expect((await request(app).post(`/api/v1/forms/${form.id}/fields`).set(bearer(A)).send({ name: 'Bad Name', label: 'x', type: 'text' })).status).toBe(400);
    expect((await request(app).post(`/api/v1/forms/${form.id}/fields`).set(bearer(A)).send({ name: 'sel', label: 'x', type: 'select' })).status).toBe(400);
    const malformed = await request(app).post('/api/v1/websites/5/forms').set(bearer(A)).set('Content-Type', 'application/json').send('{bad');
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect((await request(app).get('/api/v1/nope').set(bearer(A))).body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('validates automations: allow-listed types only, no URLs, known fields', async () => {
    const formId = await seedPublishedForm(app);
    const post = (body: unknown) => request(app).post(`/api/v1/forms/${formId}/automations`).set(bearer(A)).send(body as object);
    expect((await post({ actionType: 'webhook', config: { url: 'http://evil' } })).status).toBe(400);
    expect((await post({ actionType: 'email', config: { templateKey: 'http://evil.example/x', recipientField: 'email' } })).status).toBe(400);
    expect((await post({ actionType: 'email', config: { templateKey: 'ok', recipientField: 'email', url: 'http://evil' } })).status).toBe(400);
    expect((await post({ actionType: 'email', config: { templateKey: 'ok', recipientField: 'missing' } })).status).toBe(400);
    expect((await post({ actionType: 'email', config: { templateKey: 'ok', recipientField: 'name' } })).status).toBe(400);
    expect((await post({ actionType: 'crm_lead', config: { fieldMapping: { fullName: 'name' } } })).status).toBe(400); // key not snake_case
    expect((await post({ actionType: 'crm_lead', config: { fieldMapping: { full_name: 'name', email: 'email' } } })).status).toBe(200);
    expect((await post({ actionType: 'notification', config: { templateKey: 'new-lead' } })).status).toBe(200);
  });

  it('serves health, readiness and OpenAPI without authentication', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/ready')).body.status).toBe('ready');
    const spec = await request(app).get('/api/v1/openapi.json');
    expect(spec.body.openapi).toBe('3.1.0');
  });
});
