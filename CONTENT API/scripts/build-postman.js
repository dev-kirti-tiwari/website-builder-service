'use strict';
// Generates postman/Content-API.postman_collection.json and the committed (token-free)
// postman/Content-API-Local.postman_environment.json.   Run: node scripts/build-postman.js
const fs = require('node:fs');
const path = require('node:path');

const ENV_DEFAULTS = {
  baseUrl: 'http://localhost:4080',
  jwtToken: '',
  viewerToken: '',
  outsiderToken: '',
  internalServiceToken: '',
  workspaceId: '1001',
  otherWorkspaceId: '1002',
  requestId: 'req_postman_001',
  pageId: '',
  sectionId: '',
  contentId: '',
  currentRevision: '',
};
const SECRET_VARS = new Set(['jwtToken', 'viewerToken', 'outsiderToken', 'internalServiceToken']);
const SECTION_KEYS = ['features', 'images', 'testimonials', 'pricing', 'faq', 'cta', 'form'];

function buildEnvironment(values = {}) {
  const merged = { ...ENV_DEFAULTS, ...values };
  return {
    id: 'a3c1f0de-5b1e-4c55-9d52-0c0a7e1b2c01',
    name: 'Content API - Local',
    values: Object.entries(merged).map(([key, value]) => ({
      key, value, type: SECRET_VARS.has(key) ? 'secret' : 'default', enabled: true,
    })),
    _postman_variable_scope: 'environment',
  };
}

// ---------------------------------------------------------------- helpers
const T = {
  status: (n) => `pm.test('status is ${n}', () => pm.response.to.have.status(${n}));`,
  ok: () => [
    "const j = pm.response.json();",
    "pm.test('envelope success=true with requestId', () => { pm.expect(j.success).to.eql(true); pm.expect(j.meta.requestId).to.eql(pm.environment.get('requestId')); });",
  ],
  err: (code) => [
    "const j = pm.response.json();",
    `pm.test('error code ${code}', () => { pm.expect(j.success).to.eql(false); pm.expect(j.error.code).to.eql('${code}'); });`,
    "pm.test('error response leaks nothing', () => { pm.expect(JSON.stringify(j)).to.not.match(/stack|node_modules|SELECT |pg_|postgres/i); });",
  ],
};

const jsonBody = (o) => JSON.stringify(o, null, 2);
// body strings may contain Postman variables that must stay unquoted numbers
const rawJson = (s) => s;

const TOKENS = { user: '{{jwtToken}}', viewer: '{{viewerToken}}', outsider: '{{outsiderToken}}', invalid: 'not.a.valid.jwt' };

function request(name, o) {
  const {
    method = 'GET', url, auth = 'user', ws = '{{workspaceId}}', body, contentType = 'application/json',
    internal = false, pre = [], tests = [], headers = [], description,
  } = o;
  const h = [];
  if (auth !== 'none') h.push({ key: 'Authorization', value: `Bearer ${TOKENS[auth]}` });
  if (internal) h.push({ key: 'X-Internal-Service-Token', value: internal === true ? '{{internalServiceToken}}' : internal });
  if (ws) h.push({ key: 'X-Workspace-Id', value: ws });
  h.push({ key: 'X-Request-Id', value: '{{requestId}}' });
  if (body !== undefined) h.push({ key: 'Content-Type', value: contentType });
  h.push(...headers);
  const [pathPart, query] = url.split('?');
  return {
    name,
    request: {
      method,
      header: h,
      ...(body !== undefined && { body: { mode: 'raw', raw: typeof body === 'string' ? body : jsonBody(body) } }),
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: pathPart.split('/').filter(Boolean),
        ...(query && { query: query.split('&').map((q) => { const [key, value] = q.split('='); return { key, value }; }) }),
      },
      ...(description && { description }),
    },
    event: [
      ...(pre.length ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } }] : []),
      { listen: 'test', script: { type: 'text/javascript', exec: tests.flat() } },
    ],
  };
}
const folder = (name, item, description) => ({ name, ...(description && { description }), item });

const saveRevision = "pm.environment.set('currentRevision', j.data.revision);";

// ---------------------------------------------------------------- content fixtures
const heroV1 = { heading: 'Build Websites', subheading: 'Fast and flexible', description: 'Create professional pages without writing code.', mediaId: '90001', primaryButton: { label: 'Get Started', url: '/signup' } };
const heroV2 = { ...heroV1, heading: 'Build Better Websites' };
const fixtures = {
  features: { heading: 'Why choose us', description: 'Everything you need', items: [{ itemKey: 'feat-1', title: 'Fast', description: 'Loads quickly', iconMediaId: '90002' }, { itemKey: 'feat-2', title: 'Flexible' }] },
  images: { heading: 'Gallery', items: [{ itemKey: 'img-1', mediaId: '90003', alt: 'Our office', title: 'Office', caption: 'Where we work' }] },
  testimonials: { heading: 'Loved by teams', items: [{ itemKey: 't-1', quote: 'It just works.', author: 'Asha Rao', role: 'CTO', company: 'Acme', avatarMediaId: '90004' }] },
  pricing: { heading: 'Pricing', plans: [{ itemKey: 'plan-basic', name: 'Basic', displayPrice: '9', currency: 'USD', billingLabel: 'per month', description: 'For individuals', features: ['1 site', 'Email support'], button: { label: 'Choose Basic', url: '/signup?plan=basic' } }] },
  faq: { heading: 'Frequently Asked Questions', items: [{ itemKey: 'faq-1', question: 'Can I edit this later?', answer: 'Yes, you can update the content anytime.' }] },
  cta: { heading: 'Ready to start?', description: 'Launch your site today.', primaryButton: { label: 'Start free', url: 'https://example.com/start' } },
  form: { heading: 'Contact us', description: 'We reply within one business day.', helperText: 'We never share your email.' },
};

const idVar = (key) => (key === 'hero' ? '{{sectionId}}' : `{{${key}SectionId}}`);
const createBody = (type, content, extra = {}) => ({ pageId: '{{pageId}}', sectionType: type, content, ...extra });

// ---------------------------------------------------------------- collection
function buildCollection() {
  const initIds = [
    "const base = Date.now();",
    "pm.environment.set('runBase', String(base));",
    "pm.environment.set('pageId', String(base));",
    "pm.environment.set('sectionId', String(base + 1));",
    ...SECTION_KEYS.map((k, i) => `pm.environment.set('${k}SectionId', String(base + ${i + 2}));`),
    "pm.environment.set('dupTargetSectionId', String(base + 20));",
    "pm.environment.set('deleteSectionId', String(base + 21));",
    "pm.environment.set('missingSectionId', String(base + 22));",
    "pm.environment.set('requestId', 'req_pm_' + base);",
    "pm.environment.set('currentRevision', '');",
  ];

  const health = folder('Health & Readiness', [
    request('GET /health', {
      url: '/health', auth: 'none', ws: null, pre: initIds,
      tests: [T.status(200), "pm.test('liveness ok', () => pm.expect(pm.response.json().status).to.eql('ok'));"],
    }),
    request('GET /ready', {
      url: '/ready', auth: 'none', ws: null,
      tests: [T.status(200), "pm.test('postgres up', () => { const j = pm.response.json(); pm.expect(j.status).to.eql('ready'); pm.expect(j.checks.postgres).to.eql('up'); });"],
    }),
    request('GET unknown route', { url: '/api/v1/nope', auth: 'none', ws: null, tests: [T.status(404), T.err('NOT_FOUND')] }),
  ]);

  const crud = folder('Content CRUD', [
    request('POST create Hero content', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content', body: createBody('hero', heroV1),
      tests: [T.status(201), T.ok(), [
        "pm.test('revision 1, schemaVersion 1', () => { pm.expect(j.data.revision).to.eql(1); pm.expect(j.data.schemaVersion).to.eql(1); });",
        "pm.test('BIGINT ids are strings', () => { for (const k of ['id', 'pageId', 'sectionId']) pm.expect(j.data[k]).to.be.a('string'); });",
        "pm.test('content echoed', () => pm.expect(j.data.content.heading).to.eql('Build Websites'));",
        "pm.environment.set('contentId', j.data.id);",
        saveRevision,
      ]],
    }),
    request('GET content', {
      url: '/api/v1/sections/{{sectionId}}/content',
      tests: [T.status(200), T.ok(), [
        "pm.test('returns current content', () => { pm.expect(j.data.id).to.eql(pm.environment.get('contentId')); pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision'))); pm.expect(j.data.sectionType).to.eql('hero'); });",
      ]],
    }),
    request('PUT replace content (expectedRevision)', {
      method: 'PUT', url: '/api/v1/sections/{{sectionId}}/content',
      body: rawJson(`{\n  "expectedRevision": {{currentRevision}},\n  "content": ${JSON.stringify(heroV2, null, 2).replace(/\n/g, '\n  ')}\n}`),
      tests: [T.status(200), T.ok(), [
        "pm.test('revision incremented', () => pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision')) + 1));",
        "pm.test('content replaced', () => pm.expect(j.data.content.heading).to.eql('Build Better Websites'));",
        saveRevision,
      ]],
    }),
    request('PATCH partial update (merge patch; null removes key)', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content',
      body: '{\n  "expectedRevision": {{currentRevision}},\n  "content": {\n    "description": "Create professional websites faster.",\n    "subheading": null,\n    "primaryButton": { "label": "Start Now" }\n  }\n}',
      tests: [T.status(200), T.ok(), [
        "pm.test('revision incremented', () => pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision')) + 1));",
        "pm.test('patched field changed', () => pm.expect(j.data.content.description).to.eql('Create professional websites faster.'));",
        "pm.test('null removed key', () => pm.expect(j.data.content).to.not.have.property('subheading'));",
        "pm.test('untouched fields kept, nested object merged', () => { pm.expect(j.data.content.heading).to.eql('Build Better Websites'); pm.expect(j.data.content.primaryButton).to.eql({ label: 'Start Now', url: '/signup' }); });",
        saveRevision,
      ]],
    }),
  ]);

  const typeFolder = folder('Section types (Features / Images / Testimonials / Pricing / FAQ / CTA / Form)', [
    ...SECTION_KEYS.map((k) => request(`POST create ${k} content`, {
      method: 'POST', url: `/api/v1/sections/${idVar(k)}/content`, body: createBody(k, fixtures[k]),
      tests: [T.status(201), T.ok(), [
        `pm.test('${k} stored at revision 1', () => { pm.expect(j.data.sectionType).to.eql('${k}'); pm.expect(j.data.revision).to.eql(1); pm.expect(j.data.schemaVersion).to.eql(1); });`,
        `pm.test('content round-trips', () => pm.expect(j.data.content).to.eql(${JSON.stringify(fixtures[k])}));`,
      ]],
    })),
    request('GET page-level check: Hero stays Hero', {
      url: '/api/v1/sections/{{sectionId}}/content',
      tests: [T.status(200), "pm.test('section types are not mixed', () => pm.expect(pm.response.json().data.sectionType).to.eql('hero'));"],
    }),
  ]);

  const bulk = folder('Bulk Page Content', [
    request('GET bulk page content', {
      url: '/api/v1/pages/{{pageId}}/content',
      tests: [T.status(200), T.ok(), [
        "pm.test('8 section contents keyed by sectionId', () => { pm.expect(j.data.count).to.eql(8); pm.expect(Object.keys(j.data.contents)).to.have.lengthOf(8); pm.expect(j.data.contents[pm.environment.get('sectionId')].sectionType).to.eql('hero'); });",
        "pm.test('items list matches', () => pm.expect(j.data.items).to.have.lengthOf(8));",
      ]],
    }),
    request('GET bulk for page with no content', {
      url: '/api/v1/pages/999999999/content',
      tests: [T.status(200), "pm.test('empty', () => { const d = pm.response.json().data; pm.expect(d.count).to.eql(0); pm.expect(d.items).to.eql([]); });"],
    }),
  ]);

  const autosave = folder('Autosave & Concurrency', [
    request('PATCH autosave with current revision', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content',
      body: '{\n  "expectedRevision": {{currentRevision}},\n  "content": { "heading": "Autosaved Heading" }\n}',
      tests: [T.status(200), T.ok(), [
        "pm.test('saved and revision bumped', () => { pm.expect(j.data.content.heading).to.eql('Autosaved Heading'); pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision')) + 1); });",
        saveRevision,
      ]],
    }),
    request('PATCH stale expectedRevision -> 409', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content',
      pre: ["pm.environment.set('staleRevision', Number(pm.environment.get('currentRevision')) - 1);"],
      body: '{\n  "expectedRevision": {{staleRevision}},\n  "content": { "heading": "Stale overwrite attempt" }\n}',
      tests: [T.status(409), T.err('CONTENT_REVISION_CONFLICT'),
        "pm.test('reports current revision', () => pm.expect(j.error.details.currentRevision).to.eql(Number(pm.environment.get('currentRevision'))));"],
    }),
    request('GET confirms stale write did not overwrite', {
      url: '/api/v1/sections/{{sectionId}}/content',
      tests: [T.status(200), T.ok(), [
        "pm.test('no data loss', () => { pm.expect(j.data.content.heading).to.eql('Autosaved Heading'); pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision'))); });",
      ]],
    }),
    request('PUT with future revision -> 409', {
      method: 'PUT', url: '/api/v1/sections/{{sectionId}}/content',
      body: { expectedRevision: 9999, content: heroV1 },
      tests: [T.status(409), T.err('CONTENT_REVISION_CONFLICT')],
    }),
    request('PATCH a different section is independent (FAQ at its own revision)', {
      method: 'PATCH', url: '/api/v1/sections/{{faqSectionId}}/content',
      body: { expectedRevision: 1, content: { heading: 'FAQ edited independently' } },
      tests: [T.status(200), T.ok(), "pm.test('FAQ revision 2 while Hero is higher', () => { pm.expect(j.data.revision).to.eql(2); pm.expect(j.data.content.items).to.have.lengthOf(1); });"],
    }),
  ]);

  const revisions = folder('Revisions & Restore', [
    request('GET revision history', {
      url: '/api/v1/sections/{{sectionId}}/content/revisions',
      tests: [T.status(200), T.ok(), [
        "const cur = Number(pm.environment.get('currentRevision'));",
        "pm.test('one snapshot per mutation, newest first', () => { pm.expect(j.data.items).to.have.lengthOf(cur); pm.expect(j.data.items[0].revision).to.eql(cur); pm.expect(j.data.items[cur - 1].revision).to.eql(1); pm.expect(j.data.pagination.total).to.eql(cur); });",
        "pm.test('metadata only (no snapshot bodies)', () => pm.expect(j.data.items[0]).to.not.have.property('snapshot'));",
      ]],
    }),
    request('GET revision history paginated', {
      url: '/api/v1/sections/{{sectionId}}/content/revisions?limit=2&offset=1',
      tests: [T.status(200), T.ok(), "pm.test('page of 2', () => { pm.expect(j.data.items).to.have.lengthOf(2); pm.expect(j.data.pagination.limit).to.eql(2); pm.expect(j.data.pagination.offset).to.eql(1); });"],
    }),
    request('GET revision history invalid limit -> 400', {
      url: '/api/v1/sections/{{sectionId}}/content/revisions?limit=0', tests: [T.status(400), T.err('BAD_REQUEST')],
    }),
    request('POST restore revision 1 as new revision', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content/revisions/1/restore',
      body: '{\n  "expectedRevision": {{currentRevision}}\n}',
      tests: [T.status(200), T.ok(), [
        "pm.test('old content restored as NEW revision', () => { pm.expect(j.data.content.heading).to.eql('Build Websites'); pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision')) + 1); });",
        saveRevision,
      ]],
    }),
    request('GET history grew; nothing rewritten', {
      url: '/api/v1/sections/{{sectionId}}/content/revisions?limit=100',
      tests: [T.status(200), T.ok(), [
        "const cur = Number(pm.environment.get('currentRevision'));",
        "pm.test('history appended', () => { pm.expect(j.data.pagination.total).to.eql(cur); pm.expect(j.data.items.map(i => i.revision)).to.eql(Array.from({ length: cur }, (_, i) => cur - i)); });",
      ]],
    }),
    request('POST restore with stale expectedRevision -> 409', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content/revisions/2/restore',
      body: { expectedRevision: 1 }, tests: [T.status(409), T.err('CONTENT_REVISION_CONFLICT')],
    }),
    request('POST restore unknown revision -> 404', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content/revisions/9999/restore',
      body: '{\n  "expectedRevision": {{currentRevision}}\n}', tests: [T.status(404), T.err('REVISION_NOT_FOUND')],
    }),
    request('POST restore invalid revision number -> 400', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content/revisions/abc/restore',
      body: '{\n  "expectedRevision": {{currentRevision}}\n}', tests: [T.status(400), T.err('BAD_REQUEST')],
    }),
    request('GET history for section without content -> 404', {
      url: '/api/v1/sections/{{missingSectionId}}/content/revisions', tests: [T.status(404), T.err('CONTENT_NOT_FOUND')],
    }),
  ]);

  const dup = folder('Duplication (internal)', [
    request('POST duplicate content to new section', {
      method: 'POST', url: '/api/v1/internal/content/duplicate', auth: 'none', internal: true,
      body: { mappings: [{ sourceSectionId: '{{sectionId}}', targetSectionId: '{{dupTargetSectionId}}' }] },
      tests: [T.status(201), T.ok(), [
        "const d = j.data.items[0];",
        "pm.test('independent new row at revision 1', () => { pm.expect(j.data.count).to.eql(1); pm.expect(d.id).to.not.eql(pm.environment.get('contentId')); pm.expect(d.revision).to.eql(1); pm.expect(d.sectionId).to.eql(pm.environment.get('dupTargetSectionId')); pm.expect(d.sourceSectionId).to.eql(pm.environment.get('sectionId')); });",
        "pm.test('content copied', () => pm.expect(d.content.heading).to.eql('Build Websites'));",
      ]],
    }),
    request('PATCH duplicate does not touch source', {
      method: 'PATCH', url: '/api/v1/sections/{{dupTargetSectionId}}/content',
      body: { expectedRevision: 1, content: { heading: 'Only the copy changed' } },
      tests: [T.status(200), T.ok(), "pm.test('copy at revision 2', () => pm.expect(j.data.revision).to.eql(2));"],
    }),
    request('GET source unchanged after copy edit', {
      url: '/api/v1/sections/{{sectionId}}/content',
      tests: [T.status(200), T.ok(), "pm.test('source heading + revision intact', () => { pm.expect(j.data.content.heading).to.eql('Build Websites'); pm.expect(j.data.revision).to.eql(Number(pm.environment.get('currentRevision'))); });"],
    }),
    request('POST duplicate again -> 409 already exists', {
      method: 'POST', url: '/api/v1/internal/content/duplicate', auth: 'none', internal: true,
      body: { mappings: [{ sourceSectionId: '{{sectionId}}', targetSectionId: '{{dupTargetSectionId}}' }] },
      tests: [T.status(409), T.err('CONTENT_ALREADY_EXISTS')],
    }),
    request('POST duplicate missing source -> 404', {
      method: 'POST', url: '/api/v1/internal/content/duplicate', auth: 'none', internal: true,
      body: { mappings: [{ sourceSectionId: '{{missingSectionId}}', targetSectionId: '{{missingSectionId}}1' }] },
      tests: [T.status(404), T.err('CONTENT_NOT_FOUND')],
    }),
    request('POST duplicate source == target -> 400', {
      method: 'POST', url: '/api/v1/internal/content/duplicate', auth: 'none', internal: true,
      body: { mappings: [{ sourceSectionId: '{{sectionId}}', targetSectionId: '{{sectionId}}' }] },
      tests: [T.status(400), T.err('BAD_REQUEST')],
    }),
    request('POST duplicate without internal token -> 401', {
      method: 'POST', url: '/api/v1/internal/content/duplicate',
      body: { mappings: [{ sourceSectionId: '{{sectionId}}', targetSectionId: '{{missingSectionId}}' }] },
      tests: [T.status(401), T.err('AUTHORIZATION_REQUIRED')],
    }),
    request('POST duplicate with wrong internal token -> 401', {
      method: 'POST', url: '/api/v1/internal/content/duplicate', auth: 'none', internal: 'wrong-token',
      body: { mappings: [{ sourceSectionId: '{{sectionId}}', targetSectionId: '{{missingSectionId}}' }] },
      tests: [T.status(401), T.err('INVALID_TOKEN')],
    }),
  ]);

  const authz = folder('Authorization & Workspace Isolation', [
    request('GET without Authorization -> 401', { url: '/api/v1/sections/{{sectionId}}/content', auth: 'none', tests: [T.status(401), T.err('AUTHORIZATION_REQUIRED')] }),
    request('GET with invalid token -> 401', { url: '/api/v1/sections/{{sectionId}}/content', auth: 'invalid', tests: [T.status(401), T.err('INVALID_TOKEN')] }),
    request('GET with malformed Authorization scheme -> 401', {
      url: '/api/v1/sections/{{sectionId}}/content', auth: 'none', headers: [{ key: 'Authorization', value: 'Basic abc123' }],
      tests: [T.status(401), T.err('INVALID_TOKEN')],
    }),
    request('GET without X-Workspace-Id -> 400', { url: '/api/v1/sections/{{sectionId}}/content', ws: null, tests: [T.status(400), T.err('WORKSPACE_REQUIRED')] }),
    request('GET with non-numeric X-Workspace-Id -> 400', { url: '/api/v1/sections/{{sectionId}}/content', ws: 'abc', tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('GET workspace the actor is not a member of -> 403', { url: '/api/v1/sections/{{sectionId}}/content', auth: 'outsider', tests: [T.status(403), T.err('FORBIDDEN')] }),
    request('GET as read-only viewer -> 200', { url: '/api/v1/sections/{{sectionId}}/content', auth: 'viewer', tests: [T.status(200), T.ok()] }),
    request('PATCH as read-only viewer -> 403', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content', auth: 'viewer',
      body: '{\n  "expectedRevision": {{currentRevision}},\n  "content": { "heading": "viewer edit" }\n}', tests: [T.status(403), T.err('FORBIDDEN')],
    }),
    request('DELETE as read-only viewer -> 403', { method: 'DELETE', url: '/api/v1/sections/{{sectionId}}/content', auth: 'viewer', tests: [T.status(403), T.err('FORBIDDEN')] }),
    request('POST restore as read-only viewer -> 403', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content/revisions/1/restore', auth: 'viewer', body: { expectedRevision: 1 }, tests: [T.status(403), T.err('FORBIDDEN')],
    }),
    request('GET content of workspace 1001 from workspace 1002 -> 404 (not exposed)', {
      url: '/api/v1/sections/{{sectionId}}/content', ws: '{{otherWorkspaceId}}', tests: [T.status(404), T.err('CONTENT_NOT_FOUND')],
    }),
    request('PUT content of workspace 1001 from workspace 1002 -> 404', {
      method: 'PUT', url: '/api/v1/sections/{{sectionId}}/content', ws: '{{otherWorkspaceId}}', body: { expectedRevision: 1, content: heroV1 }, tests: [T.status(404), T.err('CONTENT_NOT_FOUND')],
    }),
    request('DELETE content of workspace 1001 from workspace 1002 -> 404', {
      method: 'DELETE', url: '/api/v1/sections/{{sectionId}}/content', ws: '{{otherWorkspaceId}}', tests: [T.status(404), T.err('CONTENT_NOT_FOUND')],
    }),
    request('GET revisions of workspace 1001 from workspace 1002 -> 404', {
      url: '/api/v1/sections/{{sectionId}}/content/revisions', ws: '{{otherWorkspaceId}}', tests: [T.status(404), T.err('CONTENT_NOT_FOUND')],
    }),
    request('GET bulk page of workspace 1001 from workspace 1002 -> empty', {
      url: '/api/v1/pages/{{pageId}}/content', ws: '{{otherWorkspaceId}}',
      tests: [T.status(200), "pm.test('no cross-workspace leak', () => pm.expect(pm.response.json().data.count).to.eql(0));"],
    }),
    request('POST workspaceId in body is ignored as proof of ownership', {
      method: 'POST', url: '/api/v1/sections/{{missingSectionId}}/content', auth: 'outsider',
      body: { ...createBody('hero', heroV1), workspaceId: '1001' }, tests: [T.status(403), T.err('FORBIDDEN')],
    }),
  ]);

  const bad = (name, body, status, code, extra = {}) => request(name, {
    method: 'POST', url: '/api/v1/sections/{{missingSectionId}}/content', body, tests: [T.status(status), T.err(code)], ...extra,
  });
  const validation = folder('Validation & Security', [
    bad('POST javascript: link -> 422 INVALID_LINK', createBody('hero', { heading: 'Hi', primaryButton: { label: 'Go', url: 'javascript:alert(1)' } }), 422, 'INVALID_LINK'),
    bad('POST data: link -> 422 INVALID_LINK', createBody('cta', { heading: 'Hi', primaryButton: { label: 'Go', url: 'data:text/html,<script>alert(1)</script>' } }), 422, 'INVALID_LINK'),
    bad('POST protocol-relative link -> 422 INVALID_LINK', createBody('cta', { heading: 'Hi', primaryButton: { label: 'Go', url: '//evil.example.com' } }), 422, 'INVALID_LINK'),
    bad('POST http:// (non-https) link -> 422 INVALID_LINK', createBody('cta', { heading: 'Hi', primaryButton: { label: 'Go', url: 'http://example.com' } }), 422, 'INVALID_LINK'),
    bad('POST script tag in text -> 422', createBody('hero', { heading: '<script>alert(1)</script>' }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST inline HTML in description -> 422', createBody('faq', { heading: 'FAQ', items: [{ itemKey: 'a', question: 'Q?', answer: '<img src=x onerror=alert(1)>' }] }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST unknown content key -> 422', createBody('hero', { heading: 'Hi', extra: 'nope' }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST whitespace-only heading -> 422', createBody('hero', { heading: '    ' }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST missing required heading -> 422', createBody('hero', { subheading: 'no heading' }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST heading too long -> 422', createBody('hero', { heading: 'x'.repeat(161) }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST invalid mediaId -> 422 INVALID_MEDIA_REFERENCE', createBody('hero', { heading: 'Hi', mediaId: 'abc' }), 422, 'INVALID_MEDIA_REFERENCE'),
    bad('POST duplicate itemKey -> 422', createBody('faq', { heading: 'FAQ', items: [{ itemKey: 'same', question: 'A?', answer: 'a' }, { itemKey: 'same', question: 'B?', answer: 'b' }] }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST missing itemKey -> 422', createBody('faq', { heading: 'FAQ', items: [{ question: 'A?', answer: 'a' }] }), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST unsupported sectionType -> 422 SECTION_TYPE_MISMATCH', createBody('carousel', { heading: 'Hi' }), 422, 'SECTION_TYPE_MISMATCH'),
    bad('POST sectionType does not match content shape -> 422', createBody('faq', heroV1), 422, 'CONTENT_SCHEMA_INVALID'),
    bad('POST unsupported schemaVersion -> 400', createBody('hero', heroV1, { schemaVersion: 99 }), 400, 'BAD_REQUEST'),
    bad('POST missing pageId -> 400', { sectionType: 'hero', content: heroV1 }, 400, 'BAD_REQUEST'),
    bad('POST unknown top-level field -> 400', createBody('hero', heroV1, { admin: true }), 400, 'BAD_REQUEST'),
    bad('POST content is an array -> 400', createBody('hero', []), 400, 'BAD_REQUEST'),
    request('POST invalid sectionId in path -> 400', { method: 'POST', url: '/api/v1/sections/1;DROP/content', body: createBody('hero', heroV1), tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('GET sectionId zero -> 400', { url: '/api/v1/sections/0/content', tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('GET sectionId beyond BIGINT -> 400', { url: '/api/v1/sections/9223372036854775808/content', tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('PUT missing expectedRevision -> 400', { method: 'PUT', url: '/api/v1/sections/{{sectionId}}/content', body: { content: heroV1 }, tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('PUT expectedRevision as string -> 400', { method: 'PUT', url: '/api/v1/sections/{{sectionId}}/content', body: { expectedRevision: '1', content: heroV1 }, tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('PUT expectedRevision 0 -> 400', { method: 'PUT', url: '/api/v1/sections/{{sectionId}}/content', body: { expectedRevision: 0, content: heroV1 }, tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('PATCH producing invalid final document -> 422', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content',
      body: '{\n  "expectedRevision": {{currentRevision}},\n  "content": { "heading": null }\n}', tests: [T.status(422), T.err('CONTENT_SCHEMA_INVALID')],
    }),
    request('PATCH with javascript: link -> 422', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content',
      body: '{\n  "expectedRevision": {{currentRevision}},\n  "content": { "primaryButton": { "url": "javascript:alert(1)" } }\n}', tests: [T.status(422), T.err('INVALID_LINK')],
    }),
    request('PATCH __proto__ pollution attempt is harmless', {
      method: 'PATCH', url: '/api/v1/sections/{{sectionId}}/content',
      body: '{\n  "expectedRevision": {{currentRevision}},\n  "content": { "__proto__": { "polluted": true }, "constructor": { "x": 1 } }\n}',
      tests: [T.status(200), "pm.test('did not pollute / no stray keys stored', () => { const c = pm.response.json().data.content; pm.expect(Object.keys(c).sort()).to.eql(['description', 'heading', 'mediaId', 'primaryButton', 'subheading']); pm.expect(({}).polluted).to.eql(undefined); });",
        "pm.environment.set('currentRevision', pm.response.json().data.revision);"],
    }),
    request('POST oversized payload -> 413', {
      method: 'POST', url: '/api/v1/sections/{{missingSectionId}}/content',
      pre: ["pm.request.body.raw = JSON.stringify({ pageId: pm.environment.get('pageId'), sectionType: 'hero', content: { heading: 'x'.repeat(700 * 1024) } });"],
      body: '{}', tests: [T.status(413), T.err('CONTENT_PAYLOAD_TOO_LARGE')],
    }),
    request('POST invalid JSON -> 400', { method: 'POST', url: '/api/v1/sections/{{missingSectionId}}/content', body: '{ "pageId": ', tests: [T.status(400), T.err('BAD_REQUEST')] }),
    request('POST text/plain body -> 415', {
      method: 'POST', url: '/api/v1/sections/{{missingSectionId}}/content', contentType: 'text/plain', body: 'heading=hi', tests: [T.status(415), T.err('UNSUPPORTED_MEDIA_TYPE')],
    }),
    request('POST content that already exists -> 409', {
      method: 'POST', url: '/api/v1/sections/{{sectionId}}/content', body: createBody('hero', heroV1), tests: [T.status(409), T.err('CONTENT_ALREADY_EXISTS')],
    }),
    request('Response carries security headers and X-Request-Id', {
      url: '/api/v1/sections/{{sectionId}}/content',
      tests: [T.status(200), [
        "pm.test('helmet headers present, x-powered-by absent', () => { pm.expect(pm.response.headers.get('X-Content-Type-Options')).to.eql('nosniff'); pm.expect(pm.response.headers.has('X-Powered-By')).to.eql(false); });",
        "pm.test('X-Request-Id propagated', () => pm.expect(pm.response.headers.get('X-Request-Id')).to.eql(pm.environment.get('requestId')));",
      ]],
    }),
  ]);

  const del = folder('Soft Delete', [
    request('POST create content to delete', {
      method: 'POST', url: '/api/v1/sections/{{deleteSectionId}}/content', body: createBody('cta', fixtures.cta),
      tests: [T.status(201), T.ok(), saveRevision.replace('currentRevision', 'deleteRevision'), "pm.environment.set('deleteContentId', j.data.id);"],
    }),
    request('DELETE with stale expectedRevision -> 409', {
      method: 'DELETE', url: '/api/v1/sections/{{deleteSectionId}}/content?expectedRevision=99', tests: [T.status(409), T.err('CONTENT_REVISION_CONFLICT')],
    }),
    request('DELETE with invalid expectedRevision -> 400', {
      method: 'DELETE', url: '/api/v1/sections/{{deleteSectionId}}/content?expectedRevision=abc', tests: [T.status(400), T.err('BAD_REQUEST')],
    }),
    request('DELETE soft-deletes content', {
      method: 'DELETE', url: '/api/v1/sections/{{deleteSectionId}}/content?expectedRevision={{deleteRevision}}',
      tests: [T.status(200), T.ok(), "pm.test('deleted flag', () => pm.expect(j.data.deleted).to.eql(true));"],
    }),
    request('GET after delete -> 404', { url: '/api/v1/sections/{{deleteSectionId}}/content', tests: [T.status(404), T.err('CONTENT_NOT_FOUND')] }),
    request('DELETE again -> 404', { method: 'DELETE', url: '/api/v1/sections/{{deleteSectionId}}/content', tests: [T.status(404), T.err('CONTENT_NOT_FOUND')] }),
    request('PUT after delete -> 404', { method: 'PUT', url: '/api/v1/sections/{{deleteSectionId}}/content', body: { expectedRevision: 1, content: fixtures.cta }, tests: [T.status(404), T.err('CONTENT_NOT_FOUND')] }),
    request('GET bulk page excludes deleted content', {
      url: '/api/v1/pages/{{pageId}}/content',
      tests: [T.status(200), "pm.test('deleted row hidden', () => { const d = pm.response.json().data; pm.expect(d.count).to.eql(9); pm.expect(d.contents).to.not.have.property(pm.environment.get('deleteSectionId')); });"],
    }),
    request('POST re-create after soft delete -> 201 (fresh revision 1)', {
      method: 'POST', url: '/api/v1/sections/{{deleteSectionId}}/content', body: createBody('cta', fixtures.cta),
      tests: [T.status(201), T.ok(), "pm.test('new independent row', () => { pm.expect(j.data.revision).to.eql(1); pm.expect(j.data.id).to.not.eql(pm.environment.get('deleteContentId')); });"],
    }),
  ]);

  return {
    info: {
      _postman_id: '5d0b4a4e-3b7c-4f0a-8b9e-4f6f1c9a7a10',
      name: 'Content API Service',
      description: 'Content API V1. Every request sends Authorization: Bearer {{jwtToken}} (BRR/JWT), X-Workspace-Id and X-Request-Id. '
        + 'Run folders in order (the first request, GET /health, generates fresh ids for the run). '
        + 'Mint tokens with `npm run postman:env` (writes a git-ignored environment file) or `npm run token`.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    event: [{
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          "// ensure ids exist when a single request is run on its own",
          "if (!pm.environment.get('runBase')) {",
          ...initIds.map((l) => '  ' + l),
          '}',
        ],
      },
    }],
    item: [health, crud, typeFolder, bulk, autosave, revisions, dup, authz, validation, del],
  };
}

module.exports = { buildEnvironment, buildCollection };

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'postman');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Content-API.postman_collection.json'), JSON.stringify(buildCollection(), null, 2));
  fs.writeFileSync(path.join(dir, 'Content-API-Local.postman_environment.json'), JSON.stringify(buildEnvironment(), null, 2));
  console.log('wrote postman/Content-API.postman_collection.json and postman/Content-API-Local.postman_environment.json');
}
