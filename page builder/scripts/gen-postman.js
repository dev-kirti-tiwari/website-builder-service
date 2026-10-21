// Generates postman/page-builder.postman_collection.json and postman/local.postman_environment.json.
// Tokens are signed with JWT_SECRET from .env (dev/local use only). Re-run: npm run postman:gen
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ quiet: true });

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is required in .env to mint Postman tokens.');

const WS = String(Date.now());
const WS2 = String(Date.now() + 1);
const mint = (claims) => jwt.sign(claims, secret, { expiresIn: '30d' });
const TYPES = ['hero', 'features', 'images', 'testimonials', 'pricing', 'faq', 'cta', 'form'];

const environment = {
  id: 'page-builder-local',
  name: 'Page Builder - Local',
  values: [
    ['baseUrl', `http://localhost:${process.env.PORT || 4070}`, 'default'],
    ['workspaceId', WS, 'default'],
    ['otherWorkspaceId', WS2, 'default'],
    ['token', mint({ sub: '42', workspaces: [WS] }), 'secret'],
    ['adminToken', mint({ sub: '45', workspaces: [{ id: WS, role: 'admin' }] }), 'secret'],
    ['viewerToken', mint({ sub: '44', workspaces: [{ id: WS, role: 'viewer' }] }), 'secret'],
    ['crossToken', mint({ sub: '43', workspaces: [WS, WS2] }), 'secret'],
    ['otherWorkspaceToken', mint({ sub: '46', workspaces: [WS2] }), 'secret'],
    ['internalToken', process.env.INTERNAL_SERVICE_TOKEN || '', 'secret'],
  ].map(([key, value, type]) => ({ key, value, type, enabled: true })),
  _postman_variable_scope: 'environment',
};

// ---- builders -------------------------------------------------------------
const T = {
  status: (c) => `pm.test('status is ${c}', () => pm.response.to.have.status(${c}));`,
  code: (c) => `pm.test('error code is ${c}', () => pm.expect(pm.response.json().error.code).to.eql('${c}'));`,
  ok: 'pm.test("success envelope", () => { const b = pm.response.json(); pm.expect(b.success).to.eql(true); pm.expect(b.meta.requestId).to.be.a("string"); });',
  rev: 'if (j.meta && j.meta.revision) pm.collectionVariables.set("revision", String(j.meta.revision));',
};
const J = 'const j = pm.response.json();';

function request(name, method, p, o = {}) {
  const [pathPart, queryPart] = p.split('?');
  const headers = [];
  if (o.ws !== null) headers.push({ key: 'X-Workspace-Id', value: o.ws || '{{workspaceId}}' });
  if (o.internal) headers.push({ key: 'X-Internal-Service-Token', value: '{{internalToken}}' });
  if (o.headers) headers.push(...o.headers);

  let body;
  if (o.body !== undefined) {
    const raw = typeof o.body === 'string' ? o.body : JSON.stringify(o.body, null, 2);
    body = { mode: 'raw', raw, options: { raw: { language: o.plain ? 'text' : 'json' } } };
  }
  const auth = o.auth === 'none' ? { type: 'noauth' }
    : o.auth ? { type: 'bearer', bearer: [{ key: 'token', value: `{{${o.auth}}}`, type: 'string' }] } : undefined;
  const events = [];
  if (o.pre) events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: [].concat(o.pre) } });
  events.push({ listen: 'test', script: { type: 'text/javascript', exec: [].concat(o.tests || []) } });
  return {
    name,
    event: events,
    request: {
      method,
      header: headers,
      body,
      auth,
      url: {
        raw: `{{baseUrl}}${p}`,
        host: ['{{baseUrl}}'],
        path: pathPart.split('/').filter(Boolean),
        query: queryPart ? queryPart.split('&').map((kv) => { const [key, value] = kv.split('='); return { key, value }; }) : undefined,
      },
    },
  };
}
const folder = (name, item) => ({ name, item });
const P = '/api/v1/pages/{{pageId}}';
// Reads the page's real current revision so manual clicks never send an out-of-date expectedRevision.
const REFRESH_REVISION = 'pm.sendRequest({ url: pm.environment.get("baseUrl") + "/api/v1/pages/" + pm.collectionVariables.get("pageId") + "/draft", method: "GET", header: { Authorization: "Bearer " + pm.environment.get("token"), "X-Workspace-Id": pm.environment.get("workspaceId") } }, (e, r) => { if (!e && r.code === 200) pm.collectionVariables.set("revision", String(r.json().data.revision)); });';
// Makes "page is deleted" checks order-independent: soft-delete the fixture page first (404 if already gone).
const DELETE_FIRST = 'pm.sendRequest({ url: pm.environment.get("baseUrl") + "/api/v1/pages/" + pm.collectionVariables.get("pageId"), method: "DELETE", header: { Authorization: "Bearer " + pm.environment.get("adminToken"), "X-Workspace-Id": pm.environment.get("workspaceId") } }, () => {});';

// ---- requests ---------------------------------------------------------------
const health = folder('Health & Readiness', [
  request('GET /health', 'GET', '/health', { ws: null, auth: 'none', tests: [T.status(200), `${J} pm.test('ok', () => pm.expect(j.data.status).to.eql('ok'));`] }),
  request('GET /ready', 'GET', '/ready', { ws: null, auth: 'none', tests: [T.status(200), `${J} pm.test('ready', () => pm.expect(j.data.status).to.eql('ready'));`] }),
]);

const pages = folder('Pages', [
  request('Create page', 'POST', '/api/v1/pages', {
    pre: 'pm.collectionVariables.set("slug", "landing-" + Date.now());',
    body: '{\n  "name": "  Product Landing Page  ",\n  "slug": "{{slug}}"\n}',
    tests: [T.status(201), J, T.ok,
      'pm.test("name trimmed, DRAFT, revision 1", () => { pm.expect(j.data.name).to.eql("Product Landing Page"); pm.expect(j.data.status).to.eql("DRAFT"); pm.expect(j.data.revision).to.eql(1); });',
      'pm.test("BIGINT id is a string", () => pm.expect(j.data.id).to.be.a("string"));',
      'pm.collectionVariables.set("pageId", j.data.id); pm.collectionVariables.set("revision", String(j.data.revision));'],
  }),
  request('Create page - duplicate slug (409)', 'POST', '/api/v1/pages', {
    body: '{ "name": "Clash", "slug": "{{slug}}" }', tests: [T.status(409), T.code('SLUG_CONFLICT')],
  }),
  request('List pages', 'GET', '/api/v1/pages?limit=100&q={{slug}}', {
    tests: [T.status(200), J, 'pm.test("contains created page + pagination", () => { pm.expect(j.data.map(p => p.id)).to.include(pm.collectionVariables.get("pageId")); pm.expect(j.meta.pagination.total).to.be.at.least(1); });'],
  }),
  request('Get page', 'GET', P, { tests: [T.status(200), J, 'pm.test("same page", () => pm.expect(j.data.id).to.eql(pm.collectionVariables.get("pageId")));'] }),
  request('Rename page / set status', 'PATCH', P, {
    body: { name: 'Product Landing (renamed)', status: 'PUBLISHED' },
    tests: [T.status(200), J, 'pm.test("updated", () => { pm.expect(j.data.name).to.eql("Product Landing (renamed)"); pm.expect(j.data.status).to.eql("PUBLISHED"); });'],
  }),
]);

const sections = folder('Sections', [
  request('GET section types (8)', 'GET', '/api/v1/section-types', {
    tests: [T.status(200), J, `pm.test("eight types", () => pm.expect(j.data.map(t => t.type)).to.eql(${JSON.stringify(TYPES)}));`],
  }),
  ...TYPES.map((t) => request(`Add section: ${t}`, 'POST', `${P}/sections`, {
    body: { type: t },
    tests: [T.status(201), J, `pm.collectionVariables.set("sec_${t}", j.data.id);`, T.rev,
      ...(t === 'form' ? ['pm.collectionVariables.set("fullRevision", String(j.meta.revision));'] : [])],
  })),
  request('Configure features section', 'PATCH', `${P}/sections/{{sec_features}}`, {
    body: { configuration: { columns: 4 }, responsive: { mobile: { visible: false } }, visible: false },
    tests: [T.status(200), J, T.rev, 'pm.test("merged config", () => { pm.expect(j.data.configuration.columns).to.eql(4); pm.expect(j.data.configuration.gap).to.eql("24px"); pm.expect(j.data.visible).to.eql(false); });'],
  }),
  request('Reorder sections (reverse)', 'PUT', `${P}/sections/order`, {
    pre: `const ids = ${JSON.stringify(TYPES)}.map(t => pm.collectionVariables.get("sec_" + t)).reverse(); pm.collectionVariables.set("reversedIds", JSON.stringify(ids)); pm.variables.set("reorderBody", JSON.stringify({ sectionIds: ids }));`,
    body: '{{reorderBody}}',
    tests: [T.status(200), J, T.rev, 'pm.test("order persisted", () => pm.expect(j.data.map(s => s.id)).to.eql(JSON.parse(pm.collectionVariables.get("reversedIds"))));'],
  }),
  request('Duplicate section (faq)', 'POST', `${P}/sections/{{sec_faq}}/duplicate`, {
    tests: [T.status(201), J, T.rev, 'pm.test("new id", () => pm.expect(j.data.id).to.not.eql(pm.collectionVariables.get("sec_faq")));', 'pm.collectionVariables.set("dupSectionId", j.data.id);'],
  }),
  request('Remove duplicated section', 'DELETE', `${P}/sections/{{dupSectionId}}`, { tests: [T.status(200), J, T.rev] }),
]);

const layout = folder('Layout', [
  request('Update page layout', 'PATCH', `${P}/layout`, {
    body: { layout: { variant: 'split', containerWidth: '1200px', columns: 2, gap: '24px', alignment: 'center' }, responsive: { mobile: { columns: 1 } } },
    tests: [T.status(200), J, T.rev, 'pm.test("layout stored", () => pm.expect(j.data.layout.containerWidth).to.eql("1200px"));'],
  }),
  request('Invalid layout (422)', 'PATCH', `${P}/layout`, { body: { layout: { variant: 'weird', css: 'x' } }, tests: [T.status(422), T.code('VALIDATION_ERROR')] }),
]);

const draft = folder('Draft & Autosave', [
  request('GET draft', 'GET', `${P}/draft`, {
    tests: [T.status(200), J, 'pm.collectionVariables.set("revision", String(j.data.revision));', 'pm.test("8 sections", () => pm.expect(j.data.sections.length).to.eql(8));'],
  }),
  request('Autosave at current revision', 'PATCH', `${P}/draft`, {
    pre: [REFRESH_REVISION, 'pm.collectionVariables.set("beforeAutosave", pm.collectionVariables.get("revision"));'],
    body: '{\n  "expectedRevision": {{revision}},\n  "changes": { "sections": [ { "id": "{{sec_hero}}", "configuration": { "alignment": "left" } } ] }\n}',
    tests: [T.status(200), J, 'pm.test("revision incremented", () => pm.expect(j.data.revision).to.eql(Number(pm.collectionVariables.get("beforeAutosave")) + 1));', 'pm.collectionVariables.set("staleRevision", pm.collectionVariables.get("beforeAutosave")); pm.collectionVariables.set("revision", String(j.data.revision));'],
  }),
  request('Autosave with stale revision (409)', 'PATCH', `${P}/draft`, {
    // Intentional 409: sends an out-of-date revision (always lower than the current one).
    pre: REFRESH_REVISION.replace('pm.collectionVariables.set("revision", String(r.json().data.revision));', '{ const cur = r.json().data.revision; pm.collectionVariables.set("revision", String(cur)); pm.collectionVariables.set("staleRevision", String(Math.max(1, cur - 1))); }'),
    body: '{\n  "expectedRevision": {{staleRevision}},\n  "changes": { "sections": [ { "id": "{{sec_hero}}", "configuration": { "alignment": "right" } } ] }\n}',
    tests: [T.status(409), T.code('REVISION_CONFLICT'), 'pm.test("reports current revision", () => pm.expect(pm.response.json().error.details[0].currentRevision).to.eql(Number(pm.collectionVariables.get("revision"))));'],
  }),
  request('Stale write left data intact', 'GET', `${P}/draft`, {
    tests: [T.status(200), J, 'pm.test("revision unchanged by the rejected write", () => pm.expect(j.data.revision).to.eql(Number(pm.collectionVariables.get("revision"))));'],
  }),
]);

const revisions = folder('Revisions', [
  request('List revisions', 'GET', `${P}/revisions`, {
    tests: [T.status(200), J, 'pm.test("history, newest first", () => { pm.expect(j.data.length).to.be.above(8); pm.expect(j.data[0].revision).to.be.above(j.data[1].revision); });'],
  }),
  request('Restore revision (all 8 sections, original order)', 'POST', `${P}/revisions/{{fullRevision}}/restore`, {
    pre: 'pm.collectionVariables.set("beforeRestore", pm.collectionVariables.get("revision"));',
    body: {},
    tests: [T.status(200), J, 'pm.test("new revision created", () => pm.expect(j.data.revision).to.eql(Number(pm.collectionVariables.get("beforeRestore")) + 1));', 'pm.collectionVariables.set("revision", String(j.data.revision));'],
  }),
  request('Restore unknown revision (404)', 'POST', `${P}/revisions/999999/restore`, { body: {}, tests: [T.status(404), T.code('REVISION_NOT_FOUND')] }),
]);

const preview = folder('Preview', [
  request('Set hero contentRef', 'PATCH', `${P}/sections/{{sec_hero}}`, { body: { contentRef: 'content:hero-1' }, tests: [T.status(200)] }),
  request('GET preview', 'GET', `${P}/preview`, {
    tests: [T.status(200), J,
      `pm.test("ordered structure", () => { pm.expect(j.data.sections.map(s => s.type)).to.eql(${JSON.stringify(TYPES)}); pm.expect(j.data.sections.map(s => s.position)).to.eql([1,2,3,4,5,6,7,8]); });`,
      'pm.test("content refs match sections that carry one", () => pm.expect(j.data.contentReferences).to.eql(j.data.sections.filter(s => s.contentRef).map(s => ({ sectionId: s.id, type: s.type, contentRef: s.contentRef }))));'],
  }),
]);

const duplicate = folder('Page Duplicate', [
  request('Duplicate page', 'POST', `${P}/duplicate`, {
    tests: [T.status(201), J, 'pm.test("copy slug", () => pm.expect(j.data.slug).to.eql(pm.collectionVariables.get("slug") + "-copy"));', 'pm.collectionVariables.set("dupPageId", j.data.id);'],
  }),
  request('Duplicated page has new section IDs', 'GET', '/api/v1/pages/{{dupPageId}}?include=structure', {
    tests: [T.status(200), J, 'const orig = TYPES_IDS(); function TYPES_IDS() { return ' + JSON.stringify(TYPES) + '.map(t => pm.collectionVariables.get("sec_" + t)); }',
      'pm.test("8 sections, none shared with original", () => { pm.expect(j.data.sections.length).to.eql(8); pm.expect(j.data.sections.some(s => orig.includes(s.id))).to.eql(false); });'],
  }),
]);

const authz = folder('Authorization & Workspace Isolation', [
  request('No token (401)', 'GET', '/api/v1/pages', { auth: 'none', tests: [T.status(401), T.code('AUTHORIZATION_REQUIRED')] }),
  request('Invalid token (401)', 'GET', '/api/v1/pages', { auth: 'none', headers: [{ key: 'Authorization', value: 'Bearer not.a.token' }], tests: [T.status(401), T.code('INVALID_TOKEN')] }),
  request('Missing workspace header (400)', 'GET', '/api/v1/pages', { ws: null, tests: [T.status(400), T.code('WORKSPACE_REQUIRED')] }),
  request('Actor without workspace access (403)', 'GET', '/api/v1/pages', { auth: 'otherWorkspaceToken', tests: [T.status(403), T.code('FORBIDDEN')] }),
  request('Viewer cannot create (403)', 'POST', '/api/v1/pages', { auth: 'viewerToken', body: { name: 'x', slug: 'x' }, tests: [T.status(403)] }),
  request('Viewer can read (200)', 'GET', P, { auth: 'viewerToken', tests: [T.status(200)] }),
  request('Cross-workspace page is not exposed (404)', 'GET', P, { auth: 'crossToken', ws: '{{otherWorkspaceId}}', tests: [T.status(404), T.code('PAGE_NOT_FOUND')] }),
  request('Internal service token (200)', 'GET', '/api/v1/pages', { auth: 'none', internal: true, tests: [T.status(200)] }),
]);

const validation = folder('Validation & Error Handling', [
  request('Unsupported section type (422)', 'POST', `${P}/sections`, { body: { type: 'carousel' }, tests: [T.status(422), T.code('VALIDATION_ERROR')] }),
  request('Unsupported variant (422)', 'POST', `${P}/sections`, { body: { type: 'hero', variant: 'nope' }, tests: [T.status(422), T.code('SECTION_CONFIG_INVALID')] }),
  request('Columns out of range (422)', 'POST', `${P}/sections`, { body: { type: 'features', configuration: { columns: 99 } }, tests: [T.status(422), T.code('SECTION_CONFIG_INVALID')] }),
  request('Unknown config key / raw CSS rejected (422)', 'POST', `${P}/sections`, { body: { type: 'features', configuration: { gap: 'expression(alert(1))', css: 'x' } }, tests: [T.status(422)] }),
  request('Invalid slug (422)', 'POST', '/api/v1/pages', { body: { name: 'a', slug: 'Bad Slug!' }, tests: [T.status(422), T.code('VALIDATION_ERROR')] }),
  request('Whitespace-only name (422)', 'POST', '/api/v1/pages', { body: { name: '   ', slug: 'ok-slug' }, tests: [T.status(422)] }),
  request('Reorder with duplicate IDs (422)', 'PUT', `${P}/sections/order`, {
    pre: `const ids = ${JSON.stringify(TYPES)}.map(t => pm.collectionVariables.get("sec_" + t)); ids[1] = ids[0]; pm.variables.set("dupBody", JSON.stringify({ sectionIds: ids }));`,
    body: '{{dupBody}}', tests: [T.status(422)],
  }),
  request("Section from another page (404)", 'PATCH', '/api/v1/pages/{{dupPageId}}/sections/{{sec_hero}}', { body: { visible: true }, tests: [T.status(404), T.code('SECTION_NOT_FOUND')] }),
  request('Oversized body (413)', 'POST', '/api/v1/pages', {
    pre: 'pm.variables.set("bigName", "x".repeat(600000));', body: '{"name":"{{bigName}}","slug":"big"}', tests: [T.status(413), T.code('PAYLOAD_TOO_LARGE')],
  }),
  request('Wrong content type (415)', 'POST', '/api/v1/pages', { plain: true, headers: [{ key: 'Content-Type', value: 'text/plain' }], body: 'name=x', tests: [T.status(415)] }),
  request('Malformed JSON (400)', 'POST', '/api/v1/pages', { body: '{oops', tests: [T.status(400), T.code('BAD_REQUEST')] }),
  request('Unknown route (404)', 'GET', '/api/v1/nope', { tests: [T.status(404), T.code('NOT_FOUND')] }),
]);

const cleanup = folder('Soft Delete', [
  request('Editor cannot delete (403)', 'DELETE', P, { tests: [T.status(403)] }),
  request('Admin soft-deletes page', 'DELETE', P, { auth: 'adminToken', tests: [T.status(200)] }),
  request('Deleted page is gone (404)', 'GET', P, { pre: DELETE_FIRST, tests: [T.status(404), T.code('PAGE_NOT_FOUND')] }),
  request('Deleted page cannot be mutated (404)', 'POST', `${P}/sections`, { pre: DELETE_FIRST, body: { type: 'hero' }, tests: [T.status(404)] }),
  request('Deleted page absent from list', 'GET', '/api/v1/pages?limit=100&q={{slug}}', {
    pre: DELETE_FIRST,
    tests: [T.status(200), J, 'pm.test("not listed", () => pm.expect(j.data.map(p => p.id)).to.not.include(pm.collectionVariables.get("pageId")));'],
  }),
  request('Slug reusable after delete', 'POST', '/api/v1/pages', {
    pre: DELETE_FIRST,
    body: '{ "name": "Reborn", "slug": "{{slug}}" }',
    // Last request of a full run: clear saved IDs so the next run starts from a clean slate.
    tests: [T.status(201), `["pageId","dupPageId","dupSectionId","revision","fullRevision","staleRevision","slug","reversedIds"${TYPES.map((t) => `,"sec_${t}"`).join('')}].forEach(k => pm.collectionVariables.unset(k));`],
  }),
]);

// ---- self-bootstrapping fixtures -------------------------------------------
// Any request that depends on saved variables gets them created automatically if missing,
// so every request can be run on its own (not only as part of a full ordered run).
const TRACKED = ['pageId', 'slug', 'dupPageId', 'dupSectionId', 'staleRevision', 'revision', 'fullRevision', ...TYPES.map((t) => `sec_${t}`)];
const needs = {};
(function scan(items) {
  for (const it of items) {
    if (it.item) { scan(it.item); continue; }
    if (it.name === 'Create page') continue;
    const text = JSON.stringify(it);
    const used = TRACKED.filter((v) => text.includes(`{{${v}}}`) || text.includes(`get(\\"${v}\\")`) || text.includes(`get("${v}")`) || text.includes(`"${v}"`) && !text.includes(`set(\\"${v}\\"`));
    if (used.length) needs[it.name] = used;
  }
}([health, pages, sections, layout, draft, revisions, preview, duplicate, authz, validation, cleanup]));

const bootstrap = `
const NEEDS = ${JSON.stringify(needs)};
const TYPES = ${JSON.stringify(TYPES)};
const used = NEEDS[pm.info.requestName];
if (used) {
  const cv = pm.collectionVariables;
  const base = pm.environment.get('baseUrl'), ws = pm.environment.get('workspaceId'), tok = pm.environment.get('token');
  const call = (method, path, body, done) => pm.sendRequest({
    url: base + path, method,
    header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'X-Workspace-Id': ws },
    body: body ? { mode: 'raw', raw: JSON.stringify(body) } : undefined,
  }, (err, res) => {
    if (err || res.code >= 300) { console.error('fixture ' + method + ' ' + path + ' failed', err || res.code); return; }
    done(res.json());
  });
  const addSections = (pageId, i, done) => {
    if (i >= TYPES.length) return done();
    call('POST', '/api/v1/pages/' + pageId + '/sections', { type: TYPES[i] }, (r) => {
      cv.set('sec_' + TYPES[i], r.data.id); cv.set('revision', String(r.meta.revision));
      addSections(pageId, i + 1, done);
    });
  };
  const ensurePage = (done) => {
    if (cv.get('pageId')) return done();
    const slug = 'fixture-' + Date.now();
    call('POST', '/api/v1/pages', { name: 'Fixture page', slug }, (r) => {
      cv.set('slug', slug); cv.set('pageId', r.data.id);
      addSections(r.data.id, 0, () => { cv.set('fullRevision', cv.get('revision')); done(); });
    });
  };
  const ensureDupPage = (done) => {
    if (!used.includes('dupPageId') || cv.get('dupPageId')) return done();
    call('POST', '/api/v1/pages/' + cv.get('pageId') + '/duplicate', null, (r) => { cv.set('dupPageId', r.data.id); done(); });
  };
  const ensureDupSection = (done) => {
    if (!used.includes('dupSectionId') || cv.get('dupSectionId')) return done();
    call('POST', '/api/v1/pages/' + cv.get('pageId') + '/sections/' + cv.get('sec_faq') + '/duplicate', null, (r) => {
      cv.set('dupSectionId', r.data.id); cv.set('revision', String(r.meta.revision)); done();
    });
  };
  ensurePage(() => ensureDupPage(() => ensureDupSection(() => {
    if (used.includes('staleRevision') && !cv.get('staleRevision')) cv.set('staleRevision', '1');
  })));
}
`.trim().split('\n');

const collection = {
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: bootstrap } }],
  info: {
    name: 'Page Builder API',
    description: 'Page Builder V1. Use with the "Page Builder - Local" environment. Run the whole collection in order (Runner / newman).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  item: [health, pages, sections, layout, draft, revisions, preview, duplicate, authz, validation, cleanup],
};

const out = path.join(__dirname, '..', 'postman');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'page-builder.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(out, 'local.postman_environment.json'), JSON.stringify(environment, null, 2));
console.log('wrote postman/page-builder.postman_collection.json and postman/local.postman_environment.json');
