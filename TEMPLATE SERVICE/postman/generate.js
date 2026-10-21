// Generates the Postman collections + local environment. Run: npm run postman:generate
//
// * Everything is auto-filled: the bearer token is read from ../.env, tenant/organization/user/software IDs are
//   collection variables, and templateId / versionId / applicationId / categoryId / revision / Idempotency-Key are
//   captured by test scripts.
// * Any request can also be run on its own: a collection-level pre-request script creates whatever the request
//   depends on (template, version, review state, published version, application) when it is missing or in the wrong state.
// * The generated files contain the local token, so they are git-ignored.
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
const token = (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '')
  .split(/\r?\n/).map((l) => /^STATIC_INTERNAL_TOKEN=(.*)$/.exec(l)).filter(Boolean).map((m) => m[1].trim())[0] || 'REPLACE_WITH_STATIC_INTERNAL_TOKEN';

const VARS = {
  baseUrl: 'http://localhost:4018',
  token,
  tenantId: '123456789012345',
  organizationId: '223456789012345',
  softwareId: '323456789012345',
  userId: '423456789012345',
  permissions: '*',
};

const snapshot = {
  schemaVersion: 1,
  metadata: { name: 'Creative Portfolio', locale: 'en' },
  theme: { tokens: { primary: '#234567', fontFamily: 'Inter' } },
  pages: [{ slug: '/', title: 'Home', sections: [{ type: 'hero', props: { heading: 'Build your story', alignment: 'left' }, assetRefs: ['8801'] }] }],
  navigation: [{ label: 'Home', href: '/' }],
};

const headers = (extra = [], { auth = true, json = false } = {}) => [
  ...(auth ? [
    { key: 'Authorization', value: 'Bearer {{token}}' },
    { key: 'X-Tenant-Id', value: '{{tenantId}}' },
    { key: 'X-Organization-Id', value: '{{organizationId}}' },
    { key: 'X-Software-Id', value: '{{softwareId}}' },
    { key: 'X-User-Id', value: '{{userId}}' },
    { key: 'X-Permissions', value: '{{permissions}}' },
    { key: 'X-Request-Id', value: '{{$guid}}' },
  ] : []),
  ...(json ? [{ key: 'Content-Type', value: 'application/json' }] : []),
  ...extra,
];

const checks = (status, extra = '') => `
pm.test('Status is ${status}', () => pm.response.to.have.status(${status}));
pm.test('Response is JSON envelope', () => { const j = pm.response.json(); pm.expect(j.success).to.eql(${status < 400}); pm.expect(j.requestId || (j.error && j.error.requestId)).to.be.a('string'); });
${extra}`;

function req(name, method, url, { body, hdr, status, test = '', pre = '', auth = true } = {}) {
  return {
    name,
    event: [
      ...(pre ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: pre.split('\n') } }] : []),
      { listen: 'test', script: { type: 'text/javascript', exec: checks(status, test).split('\n') } },
    ],
    request: {
      method,
      header: headers(hdr || [], { auth, json: body !== undefined }),
      ...(body !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2) } } : {}),
      url: {
        raw: `{{baseUrl}}${url}`, host: ['{{baseUrl}}'], path: url.split('?')[0].split('/').filter(Boolean),
        ...(url.includes('?') ? { query: url.split('?')[1].split('&').map((p) => ({ key: p.split('=')[0], value: p.split('=')[1] })) } : {}),
      },
    },
  };
}

const save = (v, expr) => `pm.collectionVariables.set('${v}', ${expr});`;
const T = '/api/v1/templates';
const applyBody = { websiteId: '5001', websiteName: 'My Portfolio', includeDemoContent: true, options: { locale: 'en' } };

// What each request needs before it can succeed (consumed by the bootstrap script below).
const NEEDS = {
  'GET /templates/{id}': { template: true },
  'PATCH /templates/{id} (If-Match)': { template: true, freshRevision: true },
  'POST /templates/{id}/versions (create draft)': { template: true },
  'GET /templates/{id}/versions (list)': { template: true, version: { ok: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED'], target: 'DRAFT' } },
  'GET /versions/{id}': { template: true, version: { ok: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED'], target: 'DRAFT' } },
  'POST /versions/{id}/submit-review': { version: { ok: ['DRAFT'], target: 'DRAFT' } },
  'POST /versions/{id}/approve': { version: { ok: ['IN_REVIEW'], target: 'IN_REVIEW' } },
  'POST /versions/{id}/publish': { version: { ok: ['APPROVED'], target: 'APPROVED' } },
  'GET /templates (browse/search)': { version: { ok: ['PUBLISHED'], target: 'PUBLISHED' } },
  'POST /templates/{id}/apply': { version: { ok: ['PUBLISHED'], target: 'PUBLISHED' } },
  'POST /apply (same key replays same operation)': { version: { ok: ['PUBLISHED'], target: 'PUBLISHED' }, application: true },
  'GET /template-applications/{id}': { version: { ok: ['PUBLISHED'], target: 'PUBLISHED' }, application: true },
  'POST /versions/{id}/deprecate': { version: { ok: ['PUBLISHED', 'APPROVED'], target: 'PUBLISHED' } },
  'POST /templates/{id}/archive': { template: true },
};

const bootstrap = `
(async () => {
  const NEEDS = ${JSON.stringify(NEEDS)};
  const need = NEEDS[pm.info.requestName];
  if (!need) return;
  const cv = pm.collectionVariables;
  const base = cv.get('baseUrl');
  const T = '/api/v1/templates';
  const SNAPSHOT = ${JSON.stringify(snapshot)};
  const APPLY = ${JSON.stringify(applyBody)};
  const RANK = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED'];
  const STEP = { DRAFT: 'submit-review', IN_REVIEW: 'approve', APPROVED: 'publish' };
  const hdr = (extra) => Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + cv.get('token'),
    'X-Tenant-Id': cv.get('tenantId'), 'X-Organization-Id': cv.get('organizationId'), 'X-Software-Id': cv.get('softwareId'),
    'X-User-Id': cv.get('userId'), 'X-Permissions': cv.get('permissions') }, extra || {});
  const call = (method, p, body, extra) => new Promise((resolve) => pm.sendRequest(
    { url: base + p, method, header: hdr(extra), body: body === undefined ? undefined : { mode: 'raw', raw: JSON.stringify(body) } },
    (err, res) => { let json = null; try { json = res && res.json(); } catch (e) { /* not json */ } resolve({ status: err ? 0 : res.code, json }); }));

  const createTemplate = async () => {
    const r = await call('POST', T, { name: 'Postman auto template', slug: 'postman-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), tags: ['postman'] });
    cv.set('templateId', r.json.data.id); cv.set('revision', r.json.data.revision);
    cv.unset('versionId'); cv.unset('applicationId');
  };
  const createVersion = async () => {
    const r = await call('POST', T + '/' + cv.get('templateId') + '/versions', { snapshot: SNAPSHOT, changelog: 'auto' });
    cv.set('versionId', r.json.data.id); return r.json.data.state;
  };
  const advance = async (state, target) => {
    while (RANK.indexOf(state) < RANK.indexOf(target)) {
      const r = await call('POST', T + '/' + cv.get('templateId') + '/versions/' + cv.get('versionId') + '/' + STEP[state]);
      state = r.json.data.state;
    }
    return state;
  };

  let tid = cv.get('templateId');
  if (!tid || (await call('GET', T + '/' + tid)).status !== 200) await createTemplate();
  if (need.freshRevision) {
    const r = await call('GET', T + '/' + cv.get('templateId'));
    cv.set('revision', r.json.data.revision);
  }
  if (need.version) {
    let state = null;
    const vid = cv.get('versionId');
    if (vid) {
      const r = await call('GET', T + '/' + cv.get('templateId') + '/versions/' + vid);
      state = r.status === 200 ? r.json.data.state : null;
    }
    if (state === null) state = await createVersion();
    if (need.version.ok.indexOf(state) < 0) {
      if (RANK.indexOf(state) >= 0 && RANK.indexOf(state) < RANK.indexOf(need.version.target)) {
        state = await advance(state, need.version.target);
      } else { // already past the needed state: start a fresh template/version
        await createTemplate(); state = await createVersion();
        state = await advance(state, need.version.target);
      }
    }
  }
  if (need.application) {
    const aid = cv.get('applicationId');
    if (!aid || (await call('GET', '/api/v1/template-applications/' + aid)).status !== 200) {
      const r = await call('POST', T + '/' + cv.get('templateId') + '/apply', APPLY, { 'Idempotency-Key': 'postman-boot-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) });
      cv.set('applicationId', r.json.data.applicationId);
    }
  }
})();
`;

const positive = [
  { name: '1. Operational', item: [
    req('GET /health', 'GET', '/health', { status: 200, auth: false }),
    req('GET /ready', 'GET', '/ready', { status: 200, auth: false }),
  ] },
  { name: '2. Categories & tags', item: [
    req('GET /categories', 'GET', '/api/v1/categories', { status: 200, test: save('categoryId', 'pm.response.json().data[0].id') + "\npm.test('seeded categories', () => pm.expect(pm.response.json().data.length).to.be.above(0));" }),
    req('GET /tags', 'GET', '/api/v1/tags', { status: 200 }),
  ] },
  { name: '3. Template catalog', item: [
    req('POST /templates (create)', 'POST', T, {
      status: 201,
      pre: "pm.collectionVariables.set('slug', 'creative-portfolio-' + Date.now());\nif (!pm.collectionVariables.get('categoryId')) pm.collectionVariables.set('categoryId', '1');",
      body: { name: 'Creative Portfolio', slug: '{{slug}}', description: 'Starter for creative professionals', categoryId: '{{categoryId}}', industry: 'design', visibility: 'PUBLIC', thumbnailAssetId: '8801', tags: ['portfolio', 'creative'] },
      test: save('templateId', 'pm.response.json().data.id') + "\n" + save('revision', 'pm.response.json().data.revision') + "\npm.collectionVariables.unset('versionId');\npm.collectionVariables.unset('applicationId');\npm.test('id is a string', () => pm.expect(pm.response.json().data.id).to.be.a('string'));\npm.test('starts as DRAFT', () => pm.expect(pm.response.json().data.status).to.eql('DRAFT'));",
    }),
    req('GET /templates/{id}', 'GET', `${T}/{{templateId}}`, { status: 200, test: save('revision', 'pm.response.json().data.revision') }),
    req('PATCH /templates/{id} (If-Match)', 'PATCH', `${T}/{{templateId}}`, {
      status: 200, hdr: [{ key: 'If-Match', value: '"revision-{{revision}}"' }],
      body: { description: 'Updated description', tags: ['portfolio', 'creative', 'minimal'] },
      test: "pm.test('revision bumped', () => pm.expect(pm.response.json().data.revision).to.be.above(Number(pm.collectionVariables.get('revision'))));\n" + save('revision', 'pm.response.json().data.revision'),
    }),
  ] },
  { name: '4. Versions & review lifecycle', item: [
    req('POST /templates/{id}/versions (create draft)', 'POST', `${T}/{{templateId}}/versions`, {
      status: 201, body: { snapshot, changelog: 'Initial version' },
      test: save('versionId', 'pm.response.json().data.id') + "\npm.test('checksum is sha256', () => pm.expect(pm.response.json().data.checksum).to.match(/^[a-f0-9]{64}$/));",
    }),
    req('GET /templates/{id}/versions (list)', 'GET', `${T}/{{templateId}}/versions`, { status: 200 }),
    req('GET /versions/{id}', 'GET', `${T}/{{templateId}}/versions/{{versionId}}`, { status: 200 }),
    req('POST /versions/{id}/submit-review', 'POST', `${T}/{{templateId}}/versions/{{versionId}}/submit-review`, { status: 200, test: "pm.test('IN_REVIEW', () => pm.expect(pm.response.json().data.state).to.eql('IN_REVIEW'));" }),
    req('POST /versions/{id}/approve', 'POST', `${T}/{{templateId}}/versions/{{versionId}}/approve`, { status: 200, test: "pm.test('APPROVED', () => pm.expect(pm.response.json().data.state).to.eql('APPROVED'));" }),
    req('POST /versions/{id}/publish', 'POST', `${T}/{{templateId}}/versions/{{versionId}}/publish`, { status: 200, test: "pm.test('PUBLISHED', () => pm.expect(pm.response.json().data.state).to.eql('PUBLISHED'));" }),
  ] },
  { name: '5. Browse published catalog', item: [
    req('GET /templates (browse/search)', 'GET', `${T}?limit=100&sort=createdAt&order=desc`, {
      status: 200, test: "pm.test('published template is listed', () => pm.expect(pm.response.json().data.map(t => t.id)).to.include(pm.collectionVariables.get('templateId')));\npm.test('pagination present', () => pm.expect(pm.response.json().pagination.limit).to.eql(100));",
    }),
  ] },
  { name: '6. Apply template', item: [
    req('POST /templates/{id}/apply', 'POST', `${T}/{{templateId}}/apply`, {
      status: 202, pre: "pm.collectionVariables.set('idemKey', pm.variables.replaceIn('{{$guid}}'));",
      hdr: [{ key: 'Idempotency-Key', value: '{{idemKey}}' }], body: applyBody,
      test: save('applicationId', 'pm.response.json().data.applicationId'),
    }),
    req('POST /apply (same key replays same operation)', 'POST', `${T}/{{templateId}}/apply`, {
      status: 202, hdr: [{ key: 'Idempotency-Key', value: '{{idemKey}}' }], body: applyBody,
      pre: "if (!pm.collectionVariables.get('idemKey')) pm.collectionVariables.set('idemKey', pm.variables.replaceIn('{{$guid}}'));",
      test: "pm.test('returns an application', () => pm.expect(pm.response.json().data.applicationId).to.be.a('string'));",
    }),
    req('GET /template-applications/{id}', 'GET', '/api/v1/template-applications/{{applicationId}}', {
      status: 200,
      test: "pm.test('status is a known value', () => pm.expect(['PENDING','VALIDATING','IN_PROGRESS','SUCCEEDED']).to.include(pm.response.json().data.status));",
    }),
  ] },
  { name: '7. Deprecate & archive', item: [
    req('POST /versions/{id}/deprecate', 'POST', `${T}/{{templateId}}/versions/{{versionId}}/deprecate`, { status: 200, test: "pm.test('DEPRECATED', () => pm.expect(pm.response.json().data.state).to.eql('DEPRECATED'));" }),
    req('POST /templates/{id}/archive', 'POST', `${T}/{{templateId}}/archive`, {
      status: 200, test: "['templateId','versionId','applicationId','idemKey'].forEach((k) => pm.collectionVariables.unset(k)); // next run starts clean",
    }),
  ] },
];

const BIG = '9223372036854775807';
const negative = [
  { name: 'Expected errors (these requests SHOULD fail)', item: [
    req('No bearer token -> 401', 'GET', T, { status: 401, auth: false }),
    req('Wrong bearer token -> 401', 'GET', T, { status: 401, auth: false, hdr: [{ key: 'Authorization', value: 'Bearer wrong-token' }] }),
    req('Missing tenant header -> 400', 'GET', T, { status: 400, hdr: [{ key: 'X-Tenant-Id', value: 'abc' }].slice(0, 0) }),
    req('Unknown template -> 404', 'GET', `${T}/${BIG}`, { status: 404 }),
    req('Invalid id -> 400', 'GET', `${T}/abc`, { status: 400 }),
    req('Invalid snapshot -> 422', 'POST', `${T}/${BIG}/versions`, { status: 422, body: { snapshot: {} } }),
    req('Apply without Idempotency-Key -> 400', 'POST', `${T}/${BIG}/apply`, { status: 400, body: { websiteId: '1' } }),
    req('No permission -> 403', 'GET', T, { status: 403, hdr: [{ key: 'X-Permissions', value: 'none' }] }),
  ] },
];
// "Missing tenant header" must omit X-Tenant-Id entirely; "wrong token"/"no permission" override single headers.
const dropHeader = (item, key) => { item.request.header = item.request.header.filter((h) => h.key !== key); };
dropHeader(negative[0].item[2], 'X-Tenant-Id');
negative[0].item[1].request.header = headers([], { auth: true }).map((h) => (h.key === 'Authorization' ? { key: 'Authorization', value: 'Bearer wrong-token' } : h));
negative[0].item[7].request.header = headers([], { auth: true }).map((h) => (h.key === 'X-Permissions' ? { key: 'X-Permissions', value: 'none' } : h));
// Idempotency negative test must carry the full auth headers (re-added after the generic builder).
negative[0].item[6].request.header = headers([], { auth: true, json: true });
negative[0].item[0].request.header = [];

const variable = Object.entries(VARS).map(([key, value]) => ({ key, value }));
const info = (name, description) => ({ name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description });

const main = {
  info: info('Template Service API', 'Run top-to-bottom (Collection Runner / newman) or run any request on its own - prerequisites are created automatically. Success requests return 200 (reads, updates, review steps), 201 (create) or 202 (apply) per the API contract.'),
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: bootstrap.split('\n') } }],
  variable,
  item: positive,
};
const neg = {
  info: info('Template Service API - expected errors', 'Negative checks: each request is EXPECTED to return the error status in its name.'),
  variable,
  item: negative,
};
const environment = {
  name: 'Template Service - local',
  values: Object.entries(VARS).map(([key, value]) => ({ key, value, enabled: true, type: key === 'token' ? 'secret' : 'default' })),
};

const out = (f, o) => fs.writeFileSync(path.join(__dirname, f), JSON.stringify(o, null, 2));
out('template-service.postman_collection.json', main);
out('template-service-errors.postman_collection.json', neg);
out('local.postman_environment.json', environment);
console.log('wrote collections + environment');
