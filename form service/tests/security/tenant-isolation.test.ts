import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { A, OTHER_ORG, OTHER_TENANT, addField, bearer, buildApp, newPool, resetDb, seedPublishedForm } from '../helpers';

const pool = newPool();
const app = buildApp(pool);

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

/** Every identity that is NOT tenant 1 / org 10 must be unable to see or change tenant A's data. */
describe.each([
  ['another tenant', OTHER_TENANT],
  ['another organization in the same tenant', OTHER_ORG],
])('%s', (_label, intruder) => {
  it('cannot read, list, update or delete A\'s form, fields, submissions or automations', async () => {
    const formId = await seedPublishedForm(app, A);
    const field = await addField(app, formId, { name: 'extra', label: 'Extra', type: 'text' }, A);
    const submit = await request(app).post(`/api/v1/public/forms/${formId}/submissions`).send({ data: { name: 'Ana', email: 'a@b.co' } });
    const subId = submit.body.data.submissionId;
    const auto = await request(app).post(`/api/v1/forms/${formId}/automations`).set(bearer(A)).send({ actionType: 'notification', config: { templateKey: 'n' } });
    expect(auto.status).toBe(200);

    const i = bearer(intruder);
    const notFound = async (p: Promise<request.Response>) => {
      const res = await p;
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Contact us');
    };

    await notFound(request(app).get(`/api/v1/forms/${formId}`).set(i));
    await notFound(request(app).patch(`/api/v1/forms/${formId}`).set(i).send({ name: 'hacked' }));
    await notFound(request(app).delete(`/api/v1/forms/${formId}`).set(i));
    await notFound(request(app).post(`/api/v1/forms/${formId}/fields`).set(i).send({ name: 'evil', label: 'x', type: 'text' }));
    await notFound(request(app).patch(`/api/v1/forms/${formId}/fields/${field.id}`).set(i).send({ label: 'hacked' }));
    await notFound(request(app).post(`/api/v1/forms/${formId}/publish`).set(i));
    await notFound(request(app).get(`/api/v1/forms/${formId}/submissions`).set(i));
    await notFound(request(app).get(`/api/v1/forms/${formId}/submissions/${subId}`).set(i));
    await notFound(request(app).patch(`/api/v1/forms/${formId}/submissions/${subId}`).set(i).send({ status: 'spam' }));
    await notFound(request(app).get(`/api/v1/forms/${formId}/automations`).set(i));
    await notFound(request(app).post(`/api/v1/forms/${formId}/automations`).set(i).send({ actionType: 'notification', config: { templateKey: 'x' } }));

    // List and count see nothing, even for the same websiteId.
    const list = await request(app).get('/api/v1/websites/5/forms').set(i);
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject({ items: [], pagination: { total: 0 } });

    // Nothing was mutated.
    const form = (await pool.query('SELECT name, status, deleted_at, revision FROM forms WHERE id = $1', [formId])).rows[0];
    expect(form).toMatchObject({ name: 'Contact us', status: 'published', deleted_at: null, revision: 2 });
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM form_fields WHERE form_id = $1', [formId])).rows[0].n).toBe(4);
    expect((await pool.query('SELECT status FROM form_submissions WHERE id = $1', [subId])).rows[0].status).toBe('new');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM form_automations WHERE form_id = $1', [formId])).rows[0].n).toBe(1);

    // The legitimate owner is unaffected.
    expect((await request(app).get(`/api/v1/forms/${formId}`).set(bearer(A))).status).toBe(200);
  });

  it('does not collide with A on slugs and sees only its own forms', async () => {
    await seedPublishedForm(app, A);
    const own = await request(app).post('/api/v1/websites/5/forms').set(bearer(intruder)).send({ name: 'Contact us' });
    expect(own.status).toBe(200); // same slug is fine in another scope
    const mine = await request(app).get('/api/v1/websites/5/forms').set(bearer(intruder));
    expect(mine.body.data.pagination.total).toBe(1);
    expect(mine.body.data.items[0].tenantId).toBe(intruder.tenant);
  });
});

describe('public submissions cannot choose their scope', () => {
  it('stores the submission under the form\'s own tenant/org and rejects client-supplied scope', async () => {
    const formId = await seedPublishedForm(app, A);
    const base = `/api/v1/public/forms/${formId}/submissions`;
    const good = { name: 'Ana', email: 'a@b.co' };
    expect((await request(app).post(base).send({ data: good, tenant_id: '2' })).status).toBe(400);
    expect((await request(app).post(base).send({ data: { ...good, tenant_id: '2', organization_id: '11', user_id: '1' } })).status).toBe(400);
    expect((await request(app).post(base).set({ 'X-Tenant-Id': '2', 'X-Organization-Id': '11', 'X-User-Id': '1' }).send({ data: good })).status).toBe(200);
    const row = (await pool.query('SELECT tenant_id, organization_id, user_id FROM form_submissions')).rows;
    expect(row).toEqual([{ tenant_id: '1', organization_id: '10', user_id: null }]);
  });
});
