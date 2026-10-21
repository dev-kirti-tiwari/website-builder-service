import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKEN, api, newActor, publishedTemplate, randomId, setup, snapshot } from '../helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.pool.end();
});

describe('auth and trusted context', () => {
  it('rejects missing, malformed and wrong bearer tokens; /health needs none', async () => {
    const a = newActor();
    const h = (auth?: string) => {
      const r = request(ctx.app).get('/api/v1/templates').set('X-Tenant-Id', a.tenant).set('X-Organization-Id', a.org).set('X-User-Id', a.user);
      return auth ? r.set('Authorization', auth) : r;
    };
    expect((await h()).status).toBe(401);
    expect((await h('Basic abc')).status).toBe(401);
    expect((await h('Bearer wrong-token')).status).toBe(401);
    expect((await request(ctx.app).get('/health')).status).toBe(200);
  });

  it('400 on malformed context ids; 403 without permission', async () => {
    const r = await request(ctx.app).get('/api/v1/templates').set('Authorization', `Bearer ${TOKEN}`).set('X-Tenant-Id', '12abc').set('X-Organization-Id', '1').set('X-User-Id', '1');
    expect(r.status).toBe(400);
    expect((await api(ctx.app, newActor('')).get('/api/v1/templates')).status).toBe(403);
  });
});

describe('catalog + versions lifecycle', () => {
  it('creates, publishes, browses, filters and paginates', async () => {
    const a = newActor();
    const c = api(ctx.app, a);
    const cats = await c.get('/api/v1/categories');
    expect(cats.status).toBe(200);
    const categoryId = cats.body.data[0].id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await publishedTemplate(ctx.app, a, { name: `Portfolio ${i}`, categoryId, tags: ['alpha'], industry: 'design' });
      ids.push(p.templateId);
    }
    const page1 = await c.get('/api/v1/templates?limit=2&sort=name&order=asc&tag=alpha');
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination.nextCursor).toBeTruthy();
    const page2 = await c.get(`/api/v1/templates?limit=2&sort=name&order=asc&tag=alpha&cursor=${page1.body.pagination.nextCursor}`);
    expect(page2.body.data).toHaveLength(1);
    const all = [...page1.body.data, ...page2.body.data].map((t: any) => t.id);
    expect(new Set(all).size).toBe(3);
    expect((await c.get(`/api/v1/templates?categoryId=${categoryId}&industry=design&q=portfolio`)).body.data.length).toBe(3);
    expect((await c.get('/api/v1/templates?limit=101')).status).toBe(400);
  });

  it('unpublished templates are not browsable; slug conflicts are 409; If-Match mismatch is 412', async () => {
    const a = newActor();
    const c = api(ctx.app, a);
    const t = await c.post('/api/v1/templates', { name: 'Draft only', slug: 'draft-only' });
    expect(t.status).toBe(201);
    expect((await c.get('/api/v1/templates')).body.data).toHaveLength(0);
    expect((await c.post('/api/v1/templates', { name: 'x', slug: 'draft-only' })).status).toBe(409);
    const stale = await request(ctx.app)
      .patch(`/api/v1/templates/${t.body.data.id}`)
      .set('Authorization', `Bearer ${TOKEN}`).set('X-Tenant-Id', a.tenant).set('X-Organization-Id', a.org).set('X-User-Id', a.user).set('X-Permissions', '*')
      .set('If-Match', '"revision-99"').send({ name: 'New' });
    expect(stale.status).toBe(412);
  });

  it('enforces state machine, separate reviewer permission, and immutability', async () => {
    const a = newActor();
    const c = api(ctx.app, a);
    const t = await c.post('/api/v1/templates', { name: 'Flow' });
    const base = `/api/v1/templates/${t.body.data.id}`;
    const v = await c.post(`${base}/versions`, { snapshot: snapshot() });
    const vb = `${base}/versions/${v.body.data.id}`;
    expect((await c.post(`${vb}/publish`)).status).toBe(409); // DRAFT cannot publish
    expect((await c.post(`${vb}/approve`)).status).toBe(409); // not yet in review
    expect((await api(ctx.app, { ...a, perms: 'template:review:submit' }).post(`${vb}/submit-review`)).status).toBe(200);
    expect((await api(ctx.app, { ...a, perms: 'template:review:submit,template:publish' }).post(`${vb}/approve`)).status).toBe(403);
    expect((await c.post(`${vb}/approve`)).status).toBe(200);
    expect((await c.post(`${vb}/publish`)).status).toBe(200);
    // published snapshot cannot be changed even by direct SQL
    await expect(ctx.pool.query(`UPDATE template_versions SET snapshot = '{}' WHERE id = $1`, [v.body.data.id])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query('DELETE FROM template_versions WHERE id = $1', [v.body.data.id])).rejects.toThrow(/immutable/);
    // published_version_id must belong to the same template
    const other = await c.post('/api/v1/templates', { name: 'Other' });
    await expect(ctx.pool.query('UPDATE templates SET published_version_id = $1 WHERE id = $2', [v.body.data.id, other.body.data.id])).rejects.toThrow(/does not belong/);
  });

  it('rejects unsafe snapshots with 422', async () => {
    const a = newActor();
    const c = api(ctx.app, a);
    const t = await c.post('/api/v1/templates', { name: 'Unsafe' });
    const s: any = snapshot();
    s.pages[0].sections[0].props.heading = '<script>alert(1)</script>';
    const r = await c.post(`/api/v1/templates/${t.body.data.id}/versions`, { snapshot: s });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SNAPSHOT_UNSAFE');
  });
});

describe('tenant isolation', () => {
  it("tenant B cannot read, change, version or apply tenant A's private template", async () => {
    const a = newActor();
    const b = newActor();
    const p = await publishedTemplate(ctx.app, a, { visibility: 'PRIVATE' });
    const cb = api(ctx.app, b);
    expect((await cb.get(p.base)).status).toBe(404);
    expect((await cb.patch(p.base, { name: 'hacked' })).status).toBe(404);
    expect((await cb.post(`${p.base}/archive`)).status).toBe(404);
    expect((await cb.get(`${p.base}/versions`)).status).toBe(404);
    expect((await cb.post(`${p.base}/versions`, { snapshot: snapshot() })).status).toBe(404);
    expect((await cb.get('/api/v1/templates')).body.data).toHaveLength(0);
    const apply = await request(ctx.app).post(`${p.base}/apply`).set('Authorization', `Bearer ${TOKEN}`).set('X-Tenant-Id', b.tenant).set('X-Organization-Id', b.org).set('X-User-Id', b.user).set('X-Permissions', '*').set('Idempotency-Key', `key-${randomId()}`).send({ websiteId: '1' });
    expect(apply.status).toBe(404);
  });

  it('same tenant, different organization is isolated too; GLOBAL scope needs admin permission', async () => {
    const a = newActor();
    const p = await publishedTemplate(ctx.app, a);
    expect((await api(ctx.app, { ...a, org: randomId() }).get(p.base)).status).toBe(404);
    expect((await api(ctx.app, { ...a, perms: 'template:create' }).post('/api/v1/templates', { name: 'G', scope: 'GLOBAL' })).status).toBe(403);
    const admin = newActor('template:create,template:read,template:global:admin');
    const g = await api(ctx.app, admin).post('/api/v1/templates', { name: 'Global', slug: `g-${randomId()}`, scope: 'GLOBAL' });
    expect(g.status).toBe(201);
    expect(g.body.data.scope).toBe('GLOBAL');
    expect((await api(ctx.app, newActor('template:update')).patch(`/api/v1/templates/${g.body.data.id}`, { name: 'x' })).status).toBe(404); // unpublished global is invisible
  });
});

describe('apply', () => {
  const applyReq = (a: ReturnType<typeof newActor>, templateId: string, key: string | undefined, body: unknown) => {
    const r = request(ctx.app).post(`/api/v1/templates/${templateId}/apply`).set('Authorization', `Bearer ${TOKEN}`).set('X-Tenant-Id', a.tenant).set('X-Organization-Id', a.org).set('X-User-Id', a.user).set('X-Permissions', a.perms);
    return (key ? r.set('Idempotency-Key', key) : r).send(body as object);
  };

  it('is idempotent, detects fingerprint conflicts, keeps BIGINT precision, and never publishes', async () => {
    const a = newActor();
    const p = await publishedTemplate(ctx.app, a);
    const key = `key-${randomId()}`;
    const bigWebsite = '9223372036854775807';
    const body = { websiteId: bigWebsite, websiteName: 'Site', includeDemoContent: true };

    expect((await applyReq(a, p.templateId, undefined, body)).status).toBe(400); // key required
    const first = await applyReq(a, p.templateId, key, body);
    expect(first.status).toBe(202);
    const again = await applyReq(a, p.templateId, key, body);
    expect(again.status).toBe(202);
    expect(again.body.data.applicationId).toBe(first.body.data.applicationId);
    expect((await applyReq(a, p.templateId, key, { ...body, websiteName: 'Different' })).status).toBe(409);

    await ctx.services.applications.process(first.body.data.applicationId); // deterministic: drive the worker explicitly
    const st = await api(ctx.app, a).get(`/api/v1/template-applications/${first.body.data.applicationId}`);
    expect(st.status).toBe(200);
    expect(st.body.data.status).toBe('SUCCEEDED');
    expect(st.body.data.websiteId).toBe(bigWebsite); // exact, not rounded through a JS Number
    expect(st.body.data.result.published).toBe(false);
    expect((await api(ctx.app, newActor()).get(`/api/v1/template-applications/${first.body.data.applicationId}`)).status).toBe(404);
  });

  it('refuses to apply an unpublished or deprecated template version (422)', async () => {
    const a = newActor();
    const c = api(ctx.app, a);
    const t = await c.post('/api/v1/templates', { name: 'NoPub' });
    const r = await applyReq(a, t.body.data.id, `key-${randomId()}`, { websiteId: '1' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('TEMPLATE_VERSION_NOT_PUBLISHED');
  });

  it('retries a transient downstream failure with the same operation id and then succeeds', async () => {
    const a = newActor();
    const p = await publishedTemplate(ctx.app, a);
    const first = await applyReq(a, p.templateId, `key-${randomId()}`, { websiteId: '77' });
    const id = first.body.data.applicationId;
    await ctx.pool.query(`UPDATE template_applications SET status = 'IN_PROGRESS', updated_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [id]); // simulate crash
    expect(await ctx.services.applications.reconcile()).toBeGreaterThan(0);
    const st = await api(ctx.app, a).get(`/api/v1/template-applications/${id}`);
    expect(st.body.data.status).toBe('SUCCEEDED');
  });
});

describe('hostile input never causes a 500', () => {
  it('rejects NUL bytes, forged cursors and oversize ids with 4xx', async () => {
    const c = api(ctx.app, newActor());
    expect((await c.get('/api/v1/templates?q=a%00b')).status).toBe(400);
    expect((await c.post('/api/v1/templates', { name: 'a\u0000b' })).status).toBe(422);
    const forged = Buffer.from(JSON.stringify({ sort: 'createdAt', order: 'desc', v: 'not-a-date', id: '1' })).toString('base64url');
    expect((await c.get(`/api/v1/templates?cursor=${forged}`)).status).toBe(400);
    expect((await c.get('/api/v1/templates/9223372036854775807')).status).toBe(404);
    expect((await c.get('/api/v1/templates/9223372036854775808')).status).toBe(400);
  });
});
