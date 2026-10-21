process.env.AUTH_MODE = 'jwt';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
process.env.RATE_LIMIT_MAX = '100000';
process.env.LOG_LEVEL = 'silent';
process.env.BODY_LIMIT = '16kb';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const pool = require('../../src/config/database');

const WS = String(Date.now());
const WS2 = String(Date.now() + 1);
const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET);
const editor = sign({ sub: '42', workspaces: [WS] });
const otherWs = sign({ sub: '43', workspaces: [WS2] });
const viewer = sign({ sub: '44', workspaces: [{ id: WS, role: 'viewer' }] });

let server;
let base;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function call(method, path, { token = editor, ws = WS, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (ws) h['X-Workspace-Id'] = ws;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = h['Content-Type'] || 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  return { status: res.status, body: await res.json() };
}

const TYPES = ['hero', 'features', 'images', 'testimonials', 'pricing', 'faq', 'cta', 'form'];
const state = {};

test('health and readiness', async () => {
  assert.equal((await (await fetch(`${base}/health`)).json()).data.status, 'ok');
  assert.equal((await (await fetch(`${base}/ready`)).json()).data.status, 'ready');
});

test('auth, workspace scope and authorization', async () => {
  assert.equal((await call('GET', '/api/v1/pages', { token: null })).body.error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal((await call('GET', '/api/v1/pages', { token: 'garbage' })).body.error.code, 'INVALID_TOKEN');
  assert.equal((await call('GET', '/api/v1/pages', { ws: null })).body.error.code, 'WORKSPACE_REQUIRED');
  assert.equal((await call('GET', '/api/v1/pages', { token: otherWs })).status, 403);
  const v = await call('POST', '/api/v1/pages', { token: viewer, body: { name: 'x', slug: 'x' } });
  assert.equal(v.status, 403);
  const internal = await call('GET', '/api/v1/pages', { token: null, headers: { 'X-Internal-Service-Token': 'test-internal-token' } });
  assert.equal(internal.status, 200);
});

test('page CRUD, slug rules, string IDs', async () => {
  const created = await call('POST', '/api/v1/pages', { body: { name: '  Product Landing  ', slug: 'Product-Landing' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, 'Product Landing');
  assert.equal(created.body.data.slug, 'product-landing');
  assert.equal(created.body.data.revision, 1);
  assert.equal(typeof created.body.data.id, 'string');
  state.pageId = created.body.data.id;

  const dup = await call('POST', '/api/v1/pages', { body: { name: 'Other', slug: 'product-landing' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'SLUG_CONFLICT');

  assert.equal((await call('POST', '/api/v1/pages', { body: { name: '   ', slug: 'ok' } })).status, 422);
  assert.equal((await call('POST', '/api/v1/pages', { body: { name: 'a', slug: 'Bad Slug!' } })).status, 422);

  const listed = await call('GET', '/api/v1/pages?limit=5');
  assert.equal(listed.body.meta.pagination.total, 1);

  const renamed = await call('PATCH', `/api/v1/pages/${state.pageId}`, { body: { name: 'Renamed', status: 'PUBLISHED' } });
  assert.equal(renamed.body.data.name, 'Renamed');
  assert.equal(renamed.body.data.status, 'PUBLISHED');
});

test('workspace isolation returns generic 404', async () => {
  const other = sign({ sub: '43', workspaces: [WS, WS2] });
  const res = await call('GET', `/api/v1/pages/${state.pageId}`, { token: other, ws: WS2 });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'PAGE_NOT_FOUND');
});

test('section types registry exposes the eight types', async () => {
  const res = await call('GET', '/api/v1/section-types', { ws: WS });
  assert.deepEqual(res.body.data.map((t) => t.type), TYPES);
});

test('add all eight section types', async () => {
  for (const type of TYPES) {
    const res = await call('POST', `/api/v1/pages/${state.pageId}/sections`, { body: { type } });
    assert.equal(res.status, 201, `${type}: ${JSON.stringify(res.body)}`);
    state[type] = res.body.data.id;
  }
  const draft = await call('GET', `/api/v1/pages/${state.pageId}/draft`);
  assert.deepEqual(draft.body.data.sections.map((s) => s.type), TYPES);
  assert.deepEqual(draft.body.data.sections.map((s) => s.position), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(draft.body.data.revision, 9);
});

test('invalid type, variant and config return 422', async () => {
  const p = `/api/v1/pages/${state.pageId}/sections`;
  assert.equal((await call('POST', p, { body: { type: 'carousel' } })).status, 422);
  const badVariant = await call('POST', p, { body: { type: 'hero', variant: 'nope' } });
  assert.equal(badVariant.body.error.code, 'SECTION_CONFIG_INVALID');
  assert.equal((await call('POST', p, { body: { type: 'features', configuration: { columns: 99 } } })).status, 422);
  assert.equal((await call('POST', p, { body: { type: 'features', configuration: { css: 'x' } } })).status, 422);
  assert.equal((await call('POST', p, { body: { type: 'features', configuration: { gap: 'expression(alert(1))' } } })).status, 422);
  assert.equal((await call('POST', p, { body: { type: 'features', responsive: { phone: { columns: 1 } } } })).status, 422);
});

test('configure section merges and validates', async () => {
  const p = `/api/v1/pages/${state.pageId}/sections/${state.features}`;
  const ok = await call('PATCH', p, { body: { configuration: { columns: 4 }, responsive: { mobile: { visible: false } }, visible: false } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.configuration.columns, 4);
  assert.equal(ok.body.data.configuration.gap, '24px');
  assert.equal(ok.body.data.visible, false);
  assert.equal((await call('PATCH', p, { body: { configuration: { columns: 0 } } })).status, 422);
});

test('layout update is validated', async () => {
  const p = `/api/v1/pages/${state.pageId}/layout`;
  const ok = await call('PATCH', p, { body: { layout: { variant: 'split', containerWidth: '1200px', columns: 2 }, responsive: { mobile: { columns: 1 } } } });
  assert.equal(ok.status, 200);
  assert.equal((await call('PATCH', p, { body: { layout: { variant: 'weird' } } })).status, 422);
});

test('reorder is atomic and validated', async () => {
  const p = `/api/v1/pages/${state.pageId}/sections/order`;
  const ids = TYPES.map((t) => state[t]);
  const reversed = [...ids].reverse();
  assert.equal((await call('PUT', p, { body: { sectionIds: [ids[0], ids[0], ...ids.slice(2)] } })).status, 422);
  assert.equal((await call('PUT', p, { body: { sectionIds: ids.slice(1) } })).status, 422);
  assert.equal((await call('PUT', p, { body: { sectionIds: [...ids.slice(1), '999999999'] } })).status, 404);
  const ok = await call('PUT', p, { body: { sectionIds: reversed } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.map((s) => s.id), reversed);
});

test('section from another page is rejected', async () => {
  const second = await call('POST', '/api/v1/pages', { body: { name: 'Second', slug: 'second' } });
  const res = await call('PATCH', `/api/v1/pages/${second.body.data.id}/sections/${state.hero}`, { body: { visible: true } });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'SECTION_NOT_FOUND');
});

test('duplicate and remove section', async () => {
  const base1 = `/api/v1/pages/${state.pageId}/sections/${state.faq}`;
  const dup = await call('POST', `${base1}/duplicate`);
  assert.equal(dup.status, 201);
  assert.notEqual(dup.body.data.id, state.faq);
  const rm = await call('DELETE', `/api/v1/pages/${state.pageId}/sections/${dup.body.data.id}`);
  assert.equal(rm.status, 200);
  const draft = await call('GET', `/api/v1/pages/${state.pageId}/draft`);
  assert.equal(draft.body.data.sections.length, 8);
  assert.deepEqual(draft.body.data.sections.map((s) => s.position), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('autosave increments revision; stale revision returns 409 without data loss', async () => {
  const draft = (await call('GET', `/api/v1/pages/${state.pageId}/draft`)).body.data;
  const rev = draft.revision;
  const p = `/api/v1/pages/${state.pageId}/draft`;
  const change = { sections: [{ id: state.hero, configuration: { alignment: 'left' } }] };

  const saved = await call('PATCH', p, { body: { expectedRevision: rev, changes: change } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.revision, rev + 1);

  const stale = await call('PATCH', p, { body: { expectedRevision: rev, changes: { sections: [{ id: state.hero, configuration: { alignment: 'right' } }] } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
  const after = (await call('GET', p)).body.data;
  assert.equal(after.sections.find((s) => s.id === state.hero).configuration.alignment, 'left');
  assert.equal(after.revision, rev + 1);

  const moved = await call('PATCH', p, { body: { expectedRevision: rev + 1, changes: { sections: [{ id: state.form, position: 1 }] } } });
  assert.equal(moved.body.data.sections[0].id, state.form);

  const invalid = await call('PATCH', p, { body: { expectedRevision: rev + 2, changes: { sections: [{ id: state.hero, configuration: { columns: 3 } }] } } });
  assert.equal(invalid.status, 422);
  assert.equal((await call('GET', p)).body.data.revision, rev + 2);
  state.afterAutosave = rev + 2;
});

test('revisions list and restore creates a new revision', async () => {
  const list = await call('GET', `/api/v1/pages/${state.pageId}/revisions`);
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 10);
  assert.equal(list.body.data[0].revision, state.afterAutosave);

  const restored = await call('POST', `/api/v1/pages/${state.pageId}/revisions/9/restore`, { body: {} });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.revision, state.afterAutosave + 1);
  const draft = (await call('GET', `/api/v1/pages/${state.pageId}/draft`)).body.data;
  assert.deepEqual(draft.sections.map((s) => s.type), TYPES);
  assert.equal(draft.sections.find((s) => s.type === 'hero').configuration.alignment, 'center');

  assert.equal((await call('POST', `/api/v1/pages/${state.pageId}/revisions/9999/restore`, { body: {} })).status, 404);
});

test('preview returns ordered structure and content references', async () => {
  await call('PATCH', `/api/v1/pages/${state.pageId}/sections/${state.hero}`, { body: { contentRef: 'content:hero-1' } });
  const res = await call('GET', `/api/v1/pages/${state.pageId}/preview`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.sections.map((s) => s.position), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(res.body.data.contentReferences, [{ sectionId: state.hero, type: 'hero', contentRef: 'content:hero-1' }]);
});

test('duplicate page copies structure with new IDs', async () => {
  const res = await call('POST', `/api/v1/pages/${state.pageId}/duplicate`);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.slug, 'product-landing-copy');
  const copy = await call('GET', `/api/v1/pages/${res.body.data.id}?include=structure`);
  assert.equal(copy.body.data.sections.length, 8);
  const original = (await call('GET', `/api/v1/pages/${state.pageId}/draft`)).body.data.sections.map((s) => s.id);
  assert.ok(copy.body.data.sections.every((s) => !original.includes(s.id)));
});

test('request hygiene: oversized body, wrong content type, bad JSON', async () => {
  const big = await call('POST', '/api/v1/pages', { raw: JSON.stringify({ name: 'x'.repeat(20000), slug: 'big' }) });
  assert.equal(big.status, 413);
  const wrong = await call('POST', '/api/v1/pages', { raw: 'name=x', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(wrong.status, 415);
  const bad = await call('POST', '/api/v1/pages', { raw: '{oops' });
  assert.equal(bad.status, 400);
});

test('soft-deleted page disappears and cannot be mutated; slug is reusable', async () => {
  const admin = sign({ sub: '45', workspaces: [{ id: WS, role: 'admin' }] });
  assert.equal((await call('DELETE', `/api/v1/pages/${state.pageId}`)).status, 403);
  assert.equal((await call('DELETE', `/api/v1/pages/${state.pageId}`, { token: admin })).status, 200);
  assert.equal((await call('GET', `/api/v1/pages/${state.pageId}`)).status, 404);
  assert.equal((await call('POST', `/api/v1/pages/${state.pageId}/sections`, { body: { type: 'hero' } })).status, 404);
  const listed = await call('GET', '/api/v1/pages?limit=100');
  assert.ok(!listed.body.data.some((p) => p.id === state.pageId));
  assert.equal((await call('POST', '/api/v1/pages', { body: { name: 'Again', slug: 'product-landing' } })).status, 201);
});

test('audit events were recorded', async () => {
  const { rows } = await pool.query('SELECT DISTINCT action FROM page_audit_logs WHERE workspace_id = $1', [WS]);
  const actions = rows.map((r) => r.action);
  for (const a of ['PAGE_CREATED', 'PAGE_UPDATED', 'PAGE_DUPLICATED', 'PAGE_DELETED', 'SECTION_ADDED', 'SECTION_UPDATED',
    'SECTION_REORDERED', 'SECTION_DUPLICATED', 'SECTION_REMOVED', 'REVISION_RESTORED']) {
    assert.ok(actions.includes(a), `missing ${a}`);
  }
});
