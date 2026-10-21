'use strict';

// Integration tests: real Express app + real PostgreSQL (docker compose "db" on localhost:5433).
// Requires DATABASE_URL (loaded from .env). The tests use random workspace ids, so they do not
// collide with existing data.

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { loadConfig } = require('../../src/config');
const { createLogger } = require('../../src/logger');
const { createPool } = require('../../src/db');
const { migrate } = require('../../src/migrate');
const { createApp } = require('../../src/app');
const { fullTheme } = require('../../fixtures/fullTheme');

const base = loadConfig({ ...process.env, LOG_LEVEL: 'silent', NODE_ENV: 'test' });
const WS_A = String(Math.floor(Math.random() * 1e12) + 1e6);
const WS_B = String(Number(WS_A) + 1);

const sign = (workspaces, opts = {}, secret = base.JWT_SECRET) =>
  jwt.sign({ sub: '4242', workspaces }, secret, { algorithm: 'HS256', expiresIn: '1h', ...opts });
const adminA = sign([{ id: WS_A, role: 'admin' }]);
const adminB = sign([{ id: WS_B, role: 'admin' }]);

let pool;
let server;
let url;

async function start(configOverride = {}) {
  const config = { ...base, ...configOverride };
  const logger = createLogger(config);
  const app = createApp({ config, pool, logger });
  const s = await new Promise((resolve) => {
    const x = app.listen(0, '127.0.0.1', () => resolve(x));
  });
  return { server: s, url: `http://127.0.0.1:${s.address().port}` };
}

async function call(method, path, { token = adminA, ws = WS_A, body, headers = {}, baseUrl = url } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ws ? { 'x-workspace-id': ws } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, headers: res.headers };
}

test.before(async () => {
  const logger = createLogger({ LOG_LEVEL: 'silent' });
  pool = createPool(base, logger);
  await migrate(pool, logger);
  ({ server, url } = await start());
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await pool.query('DELETE FROM themes WHERE workspace_id IN ($1, $2)', [WS_A, WS_B]);
  await pool.end();
});

const mk = async (name, config) => (await call('POST', '/api/v1/themes', { body: { name, config } })).body.data;

test('ready/health', async () => {
  assert.equal((await call('GET', '/health', { token: null, ws: null })).status, 200);
  const r = await call('GET', '/ready', { token: null, ws: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'ready' });
});

test('auth: missing / invalid / expired / wrong-secret / alg=none tokens -> 401', async () => {
  const cases = [
    [{ token: null }, 'UNAUTHENTICATED'],
    [{ token: 'garbage' }, 'INVALID_TOKEN'],
    [{ token: sign([{ id: WS_A, role: 'admin' }], {}, 'x'.repeat(40)) }, 'INVALID_TOKEN'],
    [{ token: sign([{ id: WS_A, role: 'admin' }], { expiresIn: -10 }) }, 'TOKEN_EXPIRED'],
  ];
  for (const [opts, code] of cases) {
    const r = await call('GET', '/api/v1/themes', opts);
    assert.equal(r.status, 401, code);
    assert.equal(r.body.error.code, code);
  }
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
    JSON.stringify({ sub: '1', workspaces: [{ id: WS_A, role: 'admin' }] }),
  ).toString('base64url')}.`;
  assert.equal((await call('GET', '/api/v1/themes', { token: none })).status, 401);
});

test('workspace: header required, must be valid, must be in token', async () => {
  assert.equal((await call('GET', '/api/v1/themes', { ws: null })).body.error.code, 'WORKSPACE_REQUIRED');
  assert.equal((await call('GET', '/api/v1/themes', { ws: 'abc' })).body.error.code, 'INVALID_WORKSPACE_ID');
  const r = await call('GET', '/api/v1/themes', { ws: WS_B });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'WORKSPACE_FORBIDDEN');
});

test('roles: viewer reads only, editor cannot activate/archive', async () => {
  const viewer = sign([{ id: WS_A, role: 'viewer' }]);
  const editor = sign([{ id: WS_A, role: 'editor' }]);
  assert.equal((await call('GET', '/api/v1/themes', { token: viewer })).status, 200);
  assert.equal((await call('POST', '/api/v1/themes', { token: viewer, body: { name: 'x' } })).status, 403);
  const t = await mk('Roles', fullTheme());
  assert.equal((await call('POST', `/api/v1/themes/${t.id}/activate`, { token: editor })).status, 403);
  assert.equal((await call('DELETE', `/api/v1/themes/${t.id}`, { token: editor })).status, 403);
  assert.equal((await call('POST', `/api/v1/themes/${t.id}/duplicate`, { token: editor })).status, 201);
});

test('actor comes from the token, never from the body', async () => {
  const r = await call('POST', '/api/v1/themes', { body: { name: 'Actor', createdBy: '1' } });
  assert.equal(r.status, 400);
  const t = await mk('Actor ok');
  assert.equal(t.createdBy, '4242');
  assert.equal(t.workspaceId, WS_A);
});

test('IDs are serialized as strings', async () => {
  const t = await mk('Ids');
  assert.equal(typeof t.id, 'string');
  assert.equal(typeof t.workspaceId, 'string');
  assert.equal(typeof t.createdBy, 'string');
});

test('concurrency: two updates with the same expectedVersion -> one 200, one 409', async () => {
  const t = await mk('Race');
  const patch = (name) => call('PATCH', `/api/v1/themes/${t.id}`, { body: { expectedVersion: 1, name } });
  const results = await Promise.all([patch('A'), patch('B'), patch('C'), patch('D')]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409, 409]);
  for (const r of results.filter((x) => x.status === 409)) assert.equal(r.body.error.code, 'THEME_VERSION_CONFLICT');
  const fresh = (await call('GET', `/api/v1/themes/${t.id}`)).body.data;
  assert.equal(fresh.version, 2, 'version incremented exactly once');
});

test('concurrency: parallel activation -> exactly one wins', async () => {
  const t = await mk('RaceActivate', fullTheme());
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/api/v1/themes/${t.id}/activate`)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await call('GET', `/api/v1/themes/${t.id}`)).body.data.version, 2);
});

test('parallel creates with the same name get distinct slugs or a clean 409 (never 500)', async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/api/v1/themes', { body: { name: 'Same Name' } })));
  for (const r of rs) assert.ok([201, 409].includes(r.status), `unexpected ${r.status}`);
  const slugs = rs.filter((r) => r.status === 201).map((r) => r.body.data.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('cross-workspace isolation on every endpoint', async () => {
  const t = await mk('Isolated', fullTheme());
  const o = { token: adminB, ws: WS_B };
  assert.equal((await call('GET', `/api/v1/themes/${t.id}`, o)).status, 404);
  assert.equal((await call('PATCH', `/api/v1/themes/${t.id}`, { ...o, body: { expectedVersion: 1, name: 'x' } })).status, 404);
  assert.equal((await call('POST', `/api/v1/themes/${t.id}/validate`, o)).status, 404);
  assert.equal((await call('POST', `/api/v1/themes/${t.id}/activate`, o)).status, 404);
  assert.equal((await call('POST', `/api/v1/themes/${t.id}/duplicate`, o)).status, 404);
  assert.equal((await call('DELETE', `/api/v1/themes/${t.id}`, o)).status, 404);
  const list = await call('GET', '/api/v1/themes?pageSize=100', o);
  assert.ok(!list.body.data.some((x) => x.id === t.id));
  const untouched = (await call('GET', `/api/v1/themes/${t.id}`)).body.data;
  assert.equal(untouched.version, 1);
  assert.equal(untouched.status, 'DRAFT');
});

test('lifecycle: activate -> immutable -> duplicate -> archive; slug stays reserved', async () => {
  const t = await mk('Life', fullTheme());
  const act = await call('POST', `/api/v1/themes/${t.id}/activate`);
  assert.equal(act.body.data.status, 'ACTIVE');
  const edit = await call('PATCH', `/api/v1/themes/${t.id}`, { body: { expectedVersion: 2, name: 'x' } });
  assert.equal(edit.body.error.code, 'THEME_NOT_EDITABLE');
  const dup = (await call('POST', `/api/v1/themes/${t.id}/duplicate`)).body.data;
  assert.equal(dup.status, 'DRAFT');
  assert.equal(dup.version, 1);
  assert.deepEqual(dup.config, act.body.data.config);
  const arch = await call('DELETE', `/api/v1/themes/${t.id}`);
  assert.equal(arch.body.data.status, 'ARCHIVED');
  assert.ok(arch.body.data.archivedAt);
  const again = await call('POST', '/api/v1/themes', { body: { name: 'Other', slug: t.slug } });
  assert.equal(again.body.error.code, 'THEME_SLUG_CONFLICT');
});

test('invalid config cannot be activated; failed patch does not bump version', async () => {
  const t = await mk('Incomplete', { colors: { primary: '#000000' } });
  const act = await call('POST', `/api/v1/themes/${t.id}/activate`);
  assert.equal(act.status, 422);
  assert.equal(act.body.error.code, 'THEME_ACTIVATION_INVALID');
  const bad = await call('PATCH', `/api/v1/themes/${t.id}`, { body: { expectedVersion: 1, config: { colors: { primary: 'nope' } } } });
  assert.equal(bad.status, 422);
  assert.equal((await call('GET', `/api/v1/themes/${t.id}`)).body.data.version, 1);
});

test('list: stable ordering, pagination, search with LIKE wildcards escaped', async () => {
  for (const n of ['Page 1', 'Page 2', 'Page 3']) await mk(n);
  await mk('100% Pure_Theme');
  const p1 = await call('GET', '/api/v1/themes?pageSize=2&page=1&search=Page');
  const p2 = await call('GET', '/api/v1/themes?pageSize=2&page=2&search=Page');
  assert.equal(p1.body.meta.pagination.total, 3);
  assert.equal(p1.body.data.length + p2.body.data.length, 3);
  assert.equal(new Set([...p1.body.data, ...p2.body.data].map((x) => x.id)).size, 3);
  const wild = await call('GET', `/api/v1/themes?search=${encodeURIComponent('%')}`);
  assert.ok(wild.body.data.every((x) => /%/.test(x.name) || /%/.test(x.slug)), 'bare % must not match everything');
});

test('payload limit and config-size limit', async () => {
  const huge = await call('POST', '/api/v1/themes', { body: { name: 'x', description: 'x'.repeat(base.THEME_MAX_CONFIG_BYTES + 20000) } });
  assert.equal(huge.status, 413);
  assert.equal(huge.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('errors never leak stack traces; request id propagated', async () => {
  const r = await call('GET', '/api/v1/themes/999999999999', { headers: { 'x-request-id': 'req-abcdef-123456' } });
  assert.equal(r.headers.get('x-request-id'), 'req-abcdef-123456');
  assert.equal(r.body.requestId, 'req-abcdef-123456');
  assert.ok(!JSON.stringify(r.body).includes('stack'));
  const generated = await call('GET', '/health', { token: null, ws: null, headers: { 'x-request-id': 'bad id!' } });
  assert.notEqual(generated.headers.get('x-request-id'), 'bad id!');
});

test('internal service token is enforced when configured', async () => {
  const secured = await start({ INTERNAL_SERVICE_TOKEN: 'internal-token-1234567890' });
  try {
    const no = await call('GET', '/api/v1/themes', { baseUrl: secured.url });
    assert.equal(no.status, 401);
    assert.equal(no.body.error.code, 'INVALID_SERVICE_TOKEN');
    const bad = await call('GET', '/api/v1/themes', { baseUrl: secured.url, headers: { 'x-internal-service-token': 'wrong' } });
    assert.equal(bad.status, 401);
    const good = await call('GET', '/api/v1/themes', { baseUrl: secured.url, headers: { 'x-internal-service-token': 'internal-token-1234567890' } });
    assert.equal(good.status, 200);
  } finally {
    await new Promise((r) => secured.server.close(r));
  }
});

test('rate limiting returns 429 in the standard error envelope', async () => {
  const limited = await start({ RATE_LIMIT_MAX: 3 });
  try {
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await call('GET', '/api/v1/themes', { baseUrl: limited.url })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const r = await call('GET', '/api/v1/themes', { baseUrl: limited.url });
    assert.equal(r.body.error.code, 'RATE_LIMITED');
  } finally {
    await new Promise((r) => limited.server.close(r));
  }
});

test('log redaction: Authorization never appears in logs', async () => {
  const chunks = [];
  const captured = createLogger({ LOG_LEVEL: 'info' }, { write: (c) => chunks.push(c) });
  const app = createApp({ config: { ...base, LOG_LEVEL: 'info' }, pool, logger: captured });
  const s = await new Promise((resolve) => {
    const x = app.listen(0, '127.0.0.1', () => resolve(x));
  });
  const u = `http://127.0.0.1:${s.address().port}`;
  try {
    await call('GET', '/api/v1/themes', { baseUrl: u });
    await call('GET', '/api/v1/themes', { baseUrl: u, token: 'secret-token-value' });
    captured.info({ req: { headers: { authorization: 'Bearer leaked-header-value' } } }, 'direct redaction check');
  } finally {
    await new Promise((r) => s.close(r));
  }
  const all = chunks.join('');
  assert.ok(all.length > 0, 'something was logged');
  assert.ok(!all.includes(adminA), 'no JWT in logs');
  assert.ok(!all.includes('secret-token-value'), 'no bearer value in logs');
  assert.ok(!all.includes('leaked-header-value'), 'redact config censors Authorization');
  assert.ok(all.includes('[REDACTED]'));
});

test('audit events are emitted after commit only for successful mutations', async () => {
  const events = [];
  const pino = require('pino');
  const logger = pino({ level: 'info' }, { write: (c) => events.push(JSON.parse(c)) });
  const app = createApp({ config: { ...base, LOG_LEVEL: 'info' }, pool, logger });
  const s = await new Promise((resolve) => {
    const x = app.listen(0, '127.0.0.1', () => resolve(x));
  });
  const u = `http://127.0.0.1:${s.address().port}`;
  try {
    const t = (await call('POST', '/api/v1/themes', { baseUrl: u, body: { name: 'Audited', config: fullTheme() } })).body.data;
    await call('POST', '/api/v1/themes', { baseUrl: u, body: { name: 'Bad', config: { evil: 1 } } }); // fails -> no event
    await call('PATCH', `/api/v1/themes/${t.id}`, { baseUrl: u, body: { expectedVersion: 1, name: 'Audited 2' } });
    await call('PATCH', `/api/v1/themes/${t.id}`, { baseUrl: u, body: { expectedVersion: 1, name: 'stale' } }); // conflict -> no event
    await call('POST', `/api/v1/themes/${t.id}/activate`, { baseUrl: u });
    await call('POST', `/api/v1/themes/${t.id}/duplicate`, { baseUrl: u });
    await call('DELETE', `/api/v1/themes/${t.id}`, { baseUrl: u });
  } finally {
    await new Promise((r) => s.close(r));
  }
  const actions = events.filter((e) => e.audit).map((e) => e.event.action);
  assert.deepEqual(actions, ['THEME_CREATED', 'THEME_UPDATED', 'THEME_ACTIVATED', 'THEME_DUPLICATED', 'THEME_ARCHIVED']);
});
