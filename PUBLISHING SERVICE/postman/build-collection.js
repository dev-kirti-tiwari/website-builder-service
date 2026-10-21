// Generates publishing-api.postman_collection.json and publishing-api.postman_environment.json
const fs = require('fs');
const path = require('path');

const IDS = {
  website: '9007199254740993',
  orgOtherWebsite: '9007199254740998',
  tenantOtherWebsite: '9007199254740999',
  revOk: '9007199254740995',
  revBad: '9007199254740996',
  revFail: '9007199254740997',
  revOk2: '9007199254741001',
  revOrgOther: '9007199254741002',
  revTenantOther: '9007199254741003',
  revProp: '9007199254741004',
};

const prerequest = `
const secret = pm.environment.get('jwt_secret');
const b64url = (w) => CryptoJS.enc.Base64.stringify(w).replace(/=+$/, '').replace(/\\+/g, '-').replace(/\\//g, '_');
const enc = (o) => b64url(CryptoJS.enc.Utf8.parse(JSON.stringify(o)));
function sign(claims, key) {
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc(claims);
  return h + '.' + p + '.' + b64url(CryptoJS.HmacSHA256(h + '.' + p, key || secret));
}
const now = Math.floor(Date.now() / 1000);
const base = { iss: 'triostackone-identity', aud: 'publishing-api', sub: '501', tenant_id: '1001', organization_id: '2001',
  permissions: ['publishing:read', 'publishing:write'], iat: now, exp: now + 3600 };
pm.variables.set('token', sign(base));
pm.variables.set('readToken', sign({ ...base, permissions: ['publishing:read'] }));
pm.variables.set('expiredToken', sign({ ...base, iat: now - 7200, exp: now - 3600 }));
pm.variables.set('wrongAudToken', sign({ ...base, aud: 'someone-else' }));
pm.variables.set('badSigToken', sign(base, 'a-completely-different-secret-0123456789'));
pm.variables.set('otherTenantToken', sign({ ...base, tenant_id: '1002', organization_id: '3001' }));
`;

const status = (code) => `pm.test('Status code is ${code}', () => pm.response.to.have.status(${code}));`;
const errCode = (c) => `pm.test('Error code is ${c}', () => pm.expect(pm.response.json().error.code).to.eql('${c}'));`;
const cv = (k) => `{{${k}}}`;

function item(name, o) {
  const { method = 'GET', path: p, body, rawBody, token = 'token', tenant = '1001', org = '2001', noAuth, idem, tests = [], pre = [], headers = [] } = o;
  const h = [{ key: 'Accept', value: 'application/json' }, { key: 'X-Request-Id', value: '{{$guid}}' }];
  if (!noAuth) {
    if (token) h.push({ key: 'Authorization', value: token.startsWith('RAW:') ? token.slice(4) : `Bearer {{${token}}}` });
    if (tenant) h.push({ key: 'X-Tenant-Id', value: tenant });
    if (org) h.push({ key: 'X-Organization-Id', value: org });
  }
  if (idem) h.push({ key: 'Idempotency-Key', value: idem });
  if (body || rawBody) h.push({ key: 'Content-Type', value: 'application/json' });
  for (const x of headers) {
    const i = h.findIndex((y) => y.key === x.key);
    if (i >= 0) h.splice(i, 1);
    h.push(x);
  }
  return {
    name,
    event: [
      ...(pre.length ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } }] : []),
      { listen: 'test', script: { type: 'text/javascript', exec: tests } },
    ],
    request: {
      method,
      header: h,
      ...(rawBody ? { body: { mode: 'raw', raw: rawBody } } : {}),
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } } : {}),
      url: `{{baseUrl}}${p}`,
    },
  };
}

// Polls a deployment until it reaches a terminal state, then asserts the expected one.
function poll(name, expected, extra = []) {
  return item(name, {
    path: '/api/v1/deployments/{{deploymentId}}',
    pre: ["if (Number(pm.collectionVariables.get('pollN') || 0) > 0) { setTimeout(() => {}, 400); }"],
    tests: [
      status(200),
      'const d = pm.response.json();',
      "const terminal = ['succeeded', 'failed'].includes(d.status);",
      "const n = Number(pm.collectionVariables.get('pollN') || 0);",
      "if (!terminal && n < 40) { pm.collectionVariables.set('pollN', n + 1); postman.setNextRequest(pm.info.requestName); }",
      'else {',
      "  pm.collectionVariables.set('pollN', 0);",
      `  pm.test('Deployment reached ${expected}', () => pm.expect(d.status).to.eql('${expected}'));`,
      ...extra.map((l) => '  ' + l),
      '}',
    ],
  });
}

const W = `/api/v1/websites/${IDS.website}`;
const idemFresh = (k) => ({ pre: [`pm.collectionVariables.set('${k}', pm.variables.replaceIn('{{$guid}}'));`], idem: cv(k) });
const saveReleaseIds = [
  'const items = pm.response.json().items;',
  "pm.test('Active release listed', () => pm.expect(items.some(r => r.status === 'active')).to.be.true);",
];

const folders = [
  { name: '0. Health', item: [
    item('Health check', { path: '/health', noAuth: true, tests: [status(200), "pm.test('status ok', () => pm.expect(pm.response.json().status).to.eql('ok'));"] }),
  ] },

  { name: '1. Authentication (JWT Bearer + scope headers)', item: [
    item('Valid token -> 200', { path: `${W}/publishing-status`, tests: [
      status(200),
      `pm.test('websiteId is an exact BIGINT string', () => pm.expect(pm.response.json().websiteId).to.eql('${IDS.website}'));`,
      "pm.test('State is a valid value', () => pm.expect(['published', 'unpublished']).to.include(pm.response.json().state));",
    ] }),
    item('No Authorization header -> 401', { path: `${W}/publishing-status`, token: null, tests: [status(401), errCode('UNAUTHENTICATED')] }),
    item('Malformed Authorization scheme -> 401', { path: `${W}/publishing-status`, token: 'RAW:Basic abc123', tests: [status(401), errCode('UNAUTHENTICATED')] }),
    item('Bad signature -> 401', { path: `${W}/publishing-status`, token: 'badSigToken', tests: [status(401), errCode('INVALID_TOKEN')] }),
    item('Expired token -> 401', { path: `${W}/publishing-status`, token: 'expiredToken', tests: [status(401), errCode('INVALID_TOKEN')] }),
    item('Wrong audience -> 401', { path: `${W}/publishing-status`, token: 'wrongAudToken', tests: [status(401), errCode('INVALID_TOKEN')] }),
    item('Tenant header not matching token -> 403', { path: `${W}/publishing-status`, tenant: '1002', tests: [status(403), errCode('SCOPE_MISMATCH')] }),
    item('Organization header not matching token -> 403', { path: `${W}/publishing-status`, org: '2002', tests: [status(403), errCode('SCOPE_MISMATCH')] }),
    item('Missing scope headers -> 400', { path: `${W}/publishing-status`, tenant: null, org: null, tests: [status(400), errCode('MISSING_SCOPE_HEADERS')] }),
    item('Read-only token cannot publish -> 403', { method: 'POST', path: `${W}/publish`, token: 'readToken', idem: 'authz-check-1',
      body: { revisionId: IDS.revOk }, tests: [status(403), errCode('FORBIDDEN')] }),
    item('Unknown route -> 404', { path: '/api/v1/nope', tests: [status(404)] }),
  ] },

  { name: '2. Tenant / organization isolation', item: [
    item('Other organization website -> 404', { path: `/api/v1/websites/${IDS.orgOtherWebsite}/publishing-status`, tests: [status(404), errCode('WEBSITE_NOT_FOUND')] }),
    item('Other tenant website -> 404', { path: `/api/v1/websites/${IDS.tenantOtherWebsite}/publishing-status`, tests: [status(404), errCode('WEBSITE_NOT_FOUND')] }),
    item('Publish to other tenant website -> 404', { method: 'POST', path: `/api/v1/websites/${IDS.tenantOtherWebsite}/publish`, idem: 'isolation-1',
      body: { revisionId: IDS.revTenantOther }, tests: [status(404), errCode('WEBSITE_NOT_FOUND')] }),
    item('Invalid id format -> 400', { path: '/api/v1/websites/abc/publishing-status', tests: [status(400), errCode('INVALID_ID')] }),
  ] },

  { name: '3. Validate and publish', item: [
    item('Validate good revision -> 200 valid', { method: 'POST', path: `${W}/validate-publish`, body: { revisionId: IDS.revOk },
      tests: [status(200), "pm.test('valid', () => pm.expect(pm.response.json().valid).to.be.true);"] }),
    item('Validate bad revision -> 200 invalid with reasons', { method: 'POST', path: `${W}/validate-publish`, body: { revisionId: IDS.revBad },
      tests: [status(200), 'const b = pm.response.json();', "pm.test('invalid', () => pm.expect(b.valid).to.be.false);",
        "pm.test('route conflict + missing asset reported', () => { const c = b.errors.map(e => e.code); pm.expect(c).to.include('ROUTE_CONFLICT'); pm.expect(c).to.include('ASSET_UNAVAILABLE'); });"] }),
    item('Publish without Idempotency-Key -> 400', { method: 'POST', path: `${W}/publish`, body: { revisionId: IDS.revOk },
      tests: [status(400), errCode('IDEMPOTENCY_KEY_REQUIRED')] }),
    item('Publish invalid revision -> 422', { method: 'POST', path: `${W}/publish`, idem: 'publish-bad-1', body: { revisionId: IDS.revBad },
      tests: [status(422), errCode('VALIDATION_FAILED')] }),
    item('Publish revision of another website -> 404', { method: 'POST', path: `${W}/publish`, idem: 'publish-foreign-1', body: { revisionId: IDS.revOrgOther },
      tests: [status(404), errCode('REVISION_NOT_FOUND')] }),
    item('Publish valid revision -> 202 queued', { method: 'POST', path: `${W}/publish`, ...idemFresh('idemPublish1'),
      body: { revisionId: IDS.revOk, reason: 'Publish updated homepage' },
      tests: [status(202), 'const b = pm.response.json();',
        "pm.test('queued', () => pm.expect(b.status).to.eql('queued'));",
        `pm.test('IDs are exact decimal strings', () => { pm.expect(b.websiteId).to.eql('${IDS.website}'); pm.expect(b.revisionId).to.eql('${IDS.revOk}'); pm.expect(b.deploymentId).to.be.a('string'); });`,
        "pm.collectionVariables.set('deploymentId', b.deploymentId);"] }),
    item('Replay same Idempotency-Key + same body -> same deployment', { method: 'POST', path: `${W}/publish`, idem: cv('idemPublish1'),
      body: { revisionId: IDS.revOk, reason: 'Publish updated homepage' },
      tests: [status(202), "pm.test('replayed', () => pm.response.to.have.header('Idempotent-Replayed', 'true'));",
        "pm.test('same deploymentId', () => pm.expect(pm.response.json().deploymentId).to.eql(pm.collectionVariables.get('deploymentId')));"] }),
    item('Same Idempotency-Key + different body -> 409', { method: 'POST', path: `${W}/publish`, idem: cv('idemPublish1'),
      body: { revisionId: IDS.revOk2 }, tests: [status(409), errCode('IDEMPOTENCY_KEY_REUSED')] }),
    poll('Poll deployment until finished (publish 1)', 'succeeded'),
    item('Deployment logs -> 200', { path: '/api/v1/deployments/{{deploymentId}}/logs', tests: [status(200),
      "pm.test('has stage events', () => { const s = pm.response.json().events.map(e => e.stage); pm.expect(s).to.include.members(['validating', 'deploying', 'activating', 'succeeded']); });"] }),
    item('Publishing status -> published', { path: `${W}/publishing-status`, tests: [status(200), 'const b = pm.response.json();',
      "pm.test('published', () => pm.expect(b.state).to.eql('published'));",
      "pm.test('active release present', () => pm.expect(b.activeRelease.status).to.eql('active'));",
      "pm.collectionVariables.set('release1', b.activeRelease.releaseId);"] }),
    item('List deployments -> 200', { path: `${W}/deployments`, tests: [status(200), "pm.test('has items', () => pm.expect(pm.response.json().items.length).to.be.above(0));"] }),
    item('List releases -> 200', { path: `${W}/releases`, tests: [status(200), ...saveReleaseIds] }),
  ] },

  { name: '4. Second release and rollback', item: [
    item('Publish second revision -> 202', { method: 'POST', path: `${W}/publish`, ...idemFresh('idemPublish2'), body: { revisionId: IDS.revOk2 },
      tests: [status(202), "pm.collectionVariables.set('deploymentId', pm.response.json().deploymentId);"] }),
    poll('Poll deployment until finished (publish 2)', 'succeeded'),
    item('Status shows new active release', { path: `${W}/publishing-status`, tests: [status(200),
      "const a = pm.response.json().activeRelease;",
      "pm.test('release changed', () => pm.expect(a.releaseId).to.not.eql(pm.collectionVariables.get('release1')));",
      "pm.test('revision is the second one', () => pm.expect(a.revisionId).to.eql('" + IDS.revOk2 + "'));"] }),
    item('Rollback to previous release -> 200', { method: 'POST', path: `${W}/rollback`, ...idemFresh('idemRollback'),
      body: { releaseId: cv('release1'), reason: 'Revert' },
      tests: [status(200), 'const b = pm.response.json();', "pm.test('rollback succeeded', () => { pm.expect(b.kind).to.eql('rollback'); pm.expect(b.status).to.eql('succeeded'); });"] }),
    item('Status shows rolled-back release active', { path: `${W}/publishing-status`, tests: [status(200),
      "pm.test('release1 active again', () => pm.expect(pm.response.json().activeRelease.releaseId).to.eql(pm.collectionVariables.get('release1')));"] }),
    item('Rollback to already-active release -> 409', { method: 'POST', path: `${W}/rollback`, idem: 'rollback-active-1',
      body: { releaseId: cv('release1') }, tests: [status(409), errCode('ALREADY_ACTIVE')] }),
    item('Rollback to unknown release -> 404', { method: 'POST', path: `${W}/rollback`, idem: 'rollback-unknown-1',
      body: { releaseId: '9007199254749999' }, tests: [status(404), errCode('RELEASE_NOT_FOUND')] }),
  ] },

  { name: '5. Failure isolation and retry', item: [
    item('Publish revision that fails at deploy -> 202', { method: 'POST', path: `${W}/publish`, ...idemFresh('idemFail'), body: { revisionId: IDS.revFail },
      tests: [status(202), "pm.collectionVariables.set('deploymentId', pm.response.json().deploymentId);"] }),
    poll('Poll deployment until finished (expected failure)', 'failed', [
      "pm.test('error code recorded', () => pm.expect(d.errorCode).to.eql('PROVIDER_DEPLOY_FAILED'));"]),
    item('Previous live release preserved after failure', { path: `${W}/publishing-status`, tests: [status(200),
      "const b = pm.response.json();",
      "pm.test('still published', () => pm.expect(b.state).to.eql('published'));",
      "pm.test('same active release', () => pm.expect(b.activeRelease.releaseId).to.eql(pm.collectionVariables.get('release1')));"] }),
    item('Retry failed deployment -> 202', { method: 'POST', path: '/api/v1/deployments/{{deploymentId}}/retry', ...idemFresh('idemRetry'),
      tests: [status(202), "pm.test('queued again', () => pm.expect(pm.response.json().status).to.eql('queued'));"] }),
    poll('Poll deployment until finished (retry)', 'succeeded', [
      "pm.test('two attempts recorded', () => pm.expect(d.attempts.length).to.eql(2));"]),
    item('Retry a succeeded deployment -> 409', { method: 'POST', path: '/api/v1/deployments/{{deploymentId}}/retry', idem: 'retry-succeeded-1',
      tests: [status(409), errCode('NOT_RETRYABLE')] }),
    item('Publish revision that fails at propagation -> 202', { method: 'POST', path: `${W}/publish`, ...idemFresh('idemProp'), body: { revisionId: IDS.revProp },
      tests: [status(202), "pm.collectionVariables.set('deploymentId', pm.response.json().deploymentId);"] }),
    poll('Poll deployment until finished (propagation failure)', 'failed', [
      "pm.test('propagation failure reported accurately', () => { pm.expect(d.errorCode).to.eql('PROVIDER_PROPAGATE_FAILED'); pm.expect(d.propagationStatus).to.eql('failed'); });"]),
    item('Release stays live after propagation failure (partial state)', { path: `${W}/publishing-status`, tests: [status(200),
      `pm.test('new release is the live one', () => pm.expect(pm.response.json().activeRelease.revisionId).to.eql('${IDS.revProp}'));`] }),
    item('Retry recovers propagation only -> 202', { method: 'POST', path: '/api/v1/deployments/{{deploymentId}}/retry', ...idemFresh('idemRetryProp'),
      tests: [status(202)] }),
    poll('Poll deployment until finished (propagation recovered)', 'succeeded', [
      "pm.test('propagation completed, 2 attempts', () => { pm.expect(d.propagationStatus).to.eql('completed'); pm.expect(d.attempts.length).to.eql(2); });"]),
    item('Other tenant cannot read deployment -> 404', { path: '/api/v1/deployments/{{deploymentId}}', token: 'otherTenantToken', tenant: '1002', org: '3001',
      tests: [status(404), errCode('DEPLOYMENT_NOT_FOUND')] }),
  ] },

  { name: '6. Unpublish', item: [
    item('Unpublish -> 200', { method: 'POST', path: `${W}/unpublish`, ...idemFresh('idemUnpublish'), body: { reason: 'Take down' },
      tests: [status(200), "pm.test('unpublish succeeded', () => { const b = pm.response.json(); pm.expect(b.kind).to.eql('unpublish'); pm.expect(b.status).to.eql('succeeded'); });"] }),
    item('Status shows unpublished, history kept', { path: `${W}/publishing-status`, tests: [status(200),
      "pm.test('unpublished with no active release', () => { const b = pm.response.json(); pm.expect(b.state).to.eql('unpublished'); pm.expect(b.activeRelease).to.eql(null); });"] }),
    item('Unpublish again -> 409', { method: 'POST', path: `${W}/unpublish`, idem: 'unpublish-again-1', body: {}, tests: [status(409), errCode('NOT_PUBLISHED')] }),
    item('Release history preserved', { path: `${W}/releases`, tests: [status(200), "pm.test('3 releases kept', () => pm.expect(pm.response.json().items.length).to.be.at.least(3));"] }),
  ] },

  { name: '7. Preview sessions', item: [
    item('Create preview session -> 200', { method: 'POST', path: `${W}/preview-sessions`, body: { revisionId: IDS.revOk2, ttlSeconds: 600 },
      tests: [status(200), 'const b = pm.response.json();',
        "pm.test('active with one-time token', () => { pm.expect(b.status).to.eql('active'); pm.expect(b.token).to.be.a('string').with.length.above(20); });",
        "pm.collectionVariables.set('sessionId', b.sessionId);"] }),
    item('Create preview with unknown revision -> 404', { method: 'POST', path: `${W}/preview-sessions`, body: { revisionId: IDS.revOrgOther },
      tests: [status(404), errCode('REVISION_NOT_FOUND')] }),
    item('Create preview with invalid ttl -> 400', { method: 'POST', path: `${W}/preview-sessions`, body: { revisionId: IDS.revOk2, ttlSeconds: 5 },
      tests: [status(400), errCode('INVALID_TTL')] }),
    item('Get preview session -> 200 (token never returned)', { path: '/api/v1/preview-sessions/{{sessionId}}',
      tests: [status(200), "pm.test('active, no token', () => { const b = pm.response.json(); pm.expect(b.status).to.eql('active'); pm.expect(b).to.not.have.property('token'); });"] }),
    item('Other tenant cannot see preview -> 404', { path: '/api/v1/preview-sessions/{{sessionId}}', token: 'otherTenantToken', tenant: '1002', org: '3001', tests: [status(404)] }),
    item('Revoke preview session -> 200', { method: 'DELETE', path: '/api/v1/preview-sessions/{{sessionId}}',
      tests: [status(200), "pm.test('revoked', () => pm.expect(pm.response.json().status).to.eql('revoked'));"] }),
    item('Get revoked preview -> 200 revoked', { path: '/api/v1/preview-sessions/{{sessionId}}',
      tests: [status(200), "pm.test('revoked', () => pm.expect(pm.response.json().status).to.eql('revoked'));"] }),
  ] },

  { name: '8. Input validation, permissions and pagination', item: [
    item('Malformed JSON body -> 400', { method: 'POST', path: `${W}/validate-publish`, rawBody: '{ not json', tests: [status(400), errCode('MALFORMED_JSON')] }),
    item('Publish without revisionId -> 400', { method: 'POST', path: `${W}/publish`, idem: 'val-norev-1', body: {}, tests: [status(400), errCode('INVALID_ID')] }),
    item('Publish with numeric revisionId (precision-unsafe) -> 400', { method: 'POST', path: `${W}/publish`, idem: 'val-numrev-1', body: { revisionId: 98765 }, tests: [status(400), errCode('INVALID_ID')] }),
    item('Publish with oversized reason -> 400', { method: 'POST', path: `${W}/publish`, idem: 'val-reason-1', body: { revisionId: IDS.revOk, reason: 'x'.repeat(501) }, tests: [status(400), errCode('INVALID_REASON')] }),
    item('Rollback with invalid releaseId -> 400', { method: 'POST', path: `${W}/rollback`, idem: 'val-rb-1', body: { releaseId: 'abc' }, tests: [status(400), errCode('INVALID_ID')] }),
    item('Read-only token can read status -> 200', { path: `${W}/publishing-status`, token: 'readToken', tests: [status(200)] }),
    item('Read-only token cannot rollback -> 403', { method: 'POST', path: `${W}/rollback`, token: 'readToken', idem: 'ro-rb-1', body: { releaseId: '1' }, tests: [status(403), errCode('FORBIDDEN')] }),
    item('Read-only token cannot unpublish -> 403', { method: 'POST', path: `${W}/unpublish`, token: 'readToken', idem: 'ro-un-1', body: {}, tests: [status(403), errCode('FORBIDDEN')] }),
    item('Read-only token cannot create preview -> 403', { method: 'POST', path: `${W}/preview-sessions`, token: 'readToken', body: { revisionId: IDS.revOk }, tests: [status(403), errCode('FORBIDDEN')] }),
    item('Read-only token cannot retry -> 403', { method: 'POST', path: '/api/v1/deployments/{{deploymentId}}/retry', token: 'readToken', idem: 'ro-retry-1', tests: [status(403), errCode('FORBIDDEN')] }),
    item('Other tenant cannot revoke preview -> 404', { method: 'DELETE', path: '/api/v1/preview-sessions/{{sessionId}}', token: 'otherTenantToken', tenant: '1002', org: '3001', tests: [status(404)] }),
    item('Other tenant cannot list deployments -> 404', { path: `${W}/deployments`, token: 'otherTenantToken', tenant: '1002', org: '3001', tests: [status(404)] }),
    item('Other org cannot rollback -> 404', { method: 'POST', path: `/api/v1/websites/${IDS.orgOtherWebsite}/rollback`, idem: 'org-rb-1', body: { releaseId: '1' }, tests: [status(404)] }),
    item('Unknown deployment -> 404', { path: '/api/v1/deployments/9007199254749998', tests: [status(404), errCode('DEPLOYMENT_NOT_FOUND')] }),
    item('Pagination limit=1 -> 1 item', { path: `${W}/deployments?limit=1&offset=0`, tests: [status(200), "pm.test('one item, limit echoed', () => { const b = pm.response.json(); pm.expect(b.items.length).to.eql(1); pm.expect(b.limit).to.eql(1); });"] }),
    item('Pagination clamps limit to 100', { path: `${W}/releases?limit=5000`, tests: [status(200), "pm.test('limit clamped', () => pm.expect(pm.response.json().limit).to.eql(100));"] }),
    item('Error responses echo the request id', { path: '/api/v1/nope', headers: [{ key: 'X-Request-Id', value: 'corr-123' }], tests: [status(404), "pm.test('request id echoed', () => { pm.expect(pm.response.headers.get('X-Request-Id')).to.eql('corr-123'); pm.expect(pm.response.json().meta.requestId).to.eql('corr-123'); });"] }),
  ] },
];

const collection = {
  info: {
    name: 'TriostackOne Publishing API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest.split('\n') } }],
  variable: [{ key: 'pollN', value: '0' }],
  item: folders,
};
// The JWT secret comes from the git-ignored root .env, never from source.
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const secret = (/^JWT_SECRET=(.+)$/m.exec(envFile) || [])[1];
if (!secret) throw new Error('JWT_SECRET missing in .env');
const mkEnv = (jwtSecret) => ({
  name: 'Publishing API - local docker',
  values: [
    { key: 'baseUrl', value: 'http://localhost:4010', enabled: true },
    { key: 'jwt_secret', value: jwtSecret, enabled: true, type: 'secret' },
  ],
});

fs.writeFileSync(path.join(__dirname, 'publishing-api.postman_collection.json'), JSON.stringify(collection, null, 2));
// The environment contains the secret, so it is git-ignored and regenerated from .env.
fs.writeFileSync(path.join(__dirname, 'publishing-api.postman_environment.json'), JSON.stringify(mkEnv(secret), null, 2));
console.log('written');
