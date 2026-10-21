'use strict';

/**
 * Generates the Postman collection + environments.
 *   npm run postman:build
 *
 * JWTs are signed in the collection-level pre-request script from the `jwtSecret` environment
 * variable, so no pre-baked tokens are stored. Every request sends them in the
 * "Authorization: Bearer {{token}}" header.
 *
 * Outputs (postman/):
 *   Theme-API.postman_collection.json            committed
 *   Theme-API.postman_environment.json           committed (placeholder secret)
 *   Theme-API.local.postman_environment.json     git-ignored (real JWT_SECRET from .env)
 */

const fs = require('node:fs');
const path = require('node:path');
const { fullTheme } = require('../fixtures/fullTheme');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'postman');

function readEnvSecret() {
  try {
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const m = /^JWT_SECRET=(.+)$/m.exec(env);
    return m ? m[1].trim() : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------- scripts

const COLLECTION_PRE_REQUEST = `
// Signs HS256 JWTs for the Theme API from the "jwtSecret" environment variable.
const CJS = require("crypto-js");
const b64url = (wa) => CJS.enc.Base64.stringify(wa).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
const enc = (o) => b64url(CJS.enc.Utf8.parse(JSON.stringify(o)));
const sign = (payload, secret) => {
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc(payload);
  return head + "." + body + "." + b64url(CJS.HmacSHA256(head + "." + body, secret));
};
const secret = pm.environment.get("jwtSecret");
const ws = String(pm.environment.get("workspaceId"));
const other = String(pm.environment.get("otherWorkspaceId"));
const uid = String(pm.environment.get("userId"));
const now = Math.floor(Date.now() / 1000);
const claims = (sub, workspaces, exp) => ({ sub, workspaces, iat: now, exp: exp || now + 3600 });

pm.environment.set("token", sign(claims(uid, [{ id: ws, role: "admin" }]), secret));
pm.environment.set("editorToken", sign(claims(uid, [{ id: ws, role: "editor" }]), secret));
pm.environment.set("viewerToken", sign(claims(uid, [{ id: ws, role: "viewer" }]), secret));
pm.environment.set("otherToken", sign(claims(String(Number(uid) + 1), [{ id: other, role: "admin" }]), secret));
pm.environment.set("expiredToken", sign(claims(uid, [{ id: ws, role: "admin" }], now - 60), secret));
pm.environment.set("badSigToken", sign(claims(uid, [{ id: ws, role: "admin" }]), "not-the-real-secret-not-the-real-secret"));
pm.environment.set("algNoneToken", enc({ alg: "none", typ: "JWT" }) + "." + enc(claims(uid, [{ id: ws, role: "admin" }])) + ".");
pm.environment.set("requestId", "postman-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
if (!pm.environment.get("runId") || pm.info.requestName === "Health (liveness)") {
  pm.environment.set("runId", Date.now().toString(36));
}
`.trim();

const PREAMBLE = `
const j = () => pm.response.json();
const expectError = (status, code) => {
  pm.test("status is " + status, () => pm.response.to.have.status(status));
  pm.test("error envelope with code " + code, () => {
    const b = j();
    pm.expect(b.success).to.eql(false);
    pm.expect(b.error.code).to.eql(code);
    pm.expect(b.error.message).to.be.a("string");
    pm.expect(b.requestId).to.be.a("string");
  });
  pm.test("no stack trace or secret leaked", () => {
    const raw = pm.response.text();
    pm.expect(raw).to.not.include("node_modules");
    pm.expect(raw).to.not.include("at Object.");
    pm.expect(raw.toLowerCase()).to.not.include("jwt_secret");
  });
};
const expectOk = (status) => {
  pm.test("status is " + status, () => pm.response.to.have.status(status));
  pm.test("success envelope", () => {
    const b = j();
    pm.expect(b.success).to.eql(true);
    pm.expect(b.requestId).to.be.a("string");
  });
};
const hasDetail = (path, code) => pm.test("details report " + path + (code ? " (" + code + ")" : ""), () => {
  pm.expect(j().error.details.some((d) => d.path === path && (!code || d.code === code))).to.eql(true);
});
`.trim();

// ---------------------------------------------------------------- builders

const items = (...xs) => xs;
const folder = (name, description, item) => ({ name, description, item });

function req(name, method, urlPath, opts = {}) {
  const headers = [];
  if (opts.auth !== null) headers.push({ key: 'Authorization', value: `Bearer {{${opts.auth || 'token'}}}` });
  if (opts.authRaw) headers.push({ key: 'Authorization', value: opts.authRaw });
  if (opts.workspace !== null) headers.push({ key: 'X-Workspace-Id', value: opts.workspace || '{{workspaceId}}' });
  headers.push({ key: 'X-Request-Id', value: '{{requestId}}' });
  headers.push({
    key: 'X-Internal-Service-Token',
    value: '{{internalServiceToken}}',
    disabled: true,
    description: 'Enable only when INTERNAL_SERVICE_TOKEN is set on the service (BFF-to-service calls).',
  });
  for (const [k, v] of Object.entries(opts.headers || {})) headers.push({ key: k, value: v });

  const hasBody = opts.body !== undefined;
  if (hasBody) headers.push({ key: 'Content-Type', value: 'application/json' });

  const [pathPart, queryPart] = urlPath.split('?');
  const query = queryPart
    ? queryPart.split('&').map((kv) => {
        const [key, ...rest] = kv.split('=');
        return { key, value: rest.join('=') };
      })
    : undefined;

  const event = [];
  if (opts.pre) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: opts.pre.split('\n') } });
  event.push({
    listen: 'test',
    script: { type: 'text/javascript', exec: (PREAMBLE + '\n' + (opts.tests || '')).split('\n') },
  });

  return {
    name,
    event,
    request: {
      method,
      header: headers,
      ...(hasBody
        ? {
            body: {
              mode: 'raw',
              raw: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body, null, 2),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
      url: {
        raw: `{{baseUrl}}${urlPath}`,
        host: ['{{baseUrl}}'],
        path: pathPart.split('/').filter(Boolean),
        ...(query ? { query } : {}),
      },
      ...(opts.description ? { description: opts.description } : {}),
    },
  };
}

const T = '/api/v1/themes';
const setVar = (name, expr) => `pm.environment.set("${name}", ${expr});`;

// ---------------------------------------------------------------- requests

const ops = folder('00 - Operations', 'Unauthenticated operational endpoints.', items(
  req('Health (liveness)', 'GET', '/health', {
    auth: null, workspace: null,
    tests: `
pm.test("status is 200", () => pm.response.to.have.status(200));
pm.test("status ok", () => pm.expect(j().status).to.eql("ok"));
pm.test("helmet headers present", () => {
  pm.expect(pm.response.headers.get("X-Content-Type-Options")).to.eql("nosniff");
  pm.expect(pm.response.headers.has("X-Powered-By")).to.eql(false);
});
pm.test("X-Request-Id echoed", () => pm.expect(pm.response.headers.get("X-Request-Id")).to.eql(pm.environment.get("requestId")));
`,
  }),
  req('Readiness (database check)', 'GET', '/ready', {
    auth: null, workspace: null,
    tests: `
pm.test("status is 200", () => pm.response.to.have.status(200));
pm.test("ready", () => pm.expect(j().status).to.eql("ready"));
pm.test("no infrastructure details leaked", () => pm.expect(Object.keys(j())).to.eql(["status"]));
`,
  }),
  req('Unknown route -> 404', 'GET', '/does-not-exist', {
    auth: null, workspace: null, tests: 'expectError(404, "ROUTE_NOT_FOUND");',
  }),
  req('CORS: allowed origin', 'GET', '/health', {
    auth: null, workspace: null, headers: { Origin: 'http://localhost:3000' },
    tests: `
pm.test("allowed origin is echoed", () => pm.expect(pm.response.headers.get("Access-Control-Allow-Origin")).to.eql("http://localhost:3000"));
`,
  }),
  req('CORS: disallowed origin', 'GET', '/health', {
    auth: null, workspace: null, headers: { Origin: 'https://evil.example' },
    tests: `
pm.test("no CORS grant for unknown origin", () => pm.expect(pm.response.headers.has("Access-Control-Allow-Origin")).to.eql(false));
`,
  }),
));

const authFolder = folder('01 - Auth & workspace (negative)', 'JWT in the Authorization header + workspace authorization.', items(
  req('No Authorization header -> 401', 'GET', T, { auth: null, tests: 'expectError(401, "UNAUTHENTICATED");' }),
  req('Wrong scheme (Basic) -> 401', 'GET', T, { auth: null, authRaw: 'Basic dXNlcjpwYXNz', tests: 'expectError(401, "UNAUTHENTICATED");' }),
  req('Garbage token -> 401', 'GET', T, { auth: null, authRaw: 'Bearer not.a.jwt', tests: 'expectError(401, "INVALID_TOKEN");' }),
  req('Bad signature -> 401', 'GET', T, { auth: 'badSigToken', tests: 'expectError(401, "INVALID_TOKEN");' }),
  req('alg=none token -> 401', 'GET', T, { auth: 'algNoneToken', tests: 'expectError(401, "INVALID_TOKEN");' }),
  req('Expired token -> 401', 'GET', T, { auth: 'expiredToken', tests: 'expectError(401, "TOKEN_EXPIRED");' }),
  req('Missing X-Workspace-Id -> 400', 'GET', T, { workspace: null, tests: 'expectError(400, "WORKSPACE_REQUIRED");' }),
  req('Non-numeric X-Workspace-Id -> 400', 'GET', T, { workspace: 'abc', tests: 'expectError(400, "INVALID_WORKSPACE_ID");' }),
  req('Workspace not in token -> 403', 'GET', T, {
    workspace: '{{otherWorkspaceId}}', tests: 'expectError(403, "WORKSPACE_FORBIDDEN");',
    description: 'X-Workspace-Id alone is not authorization: the verified token must contain the workspace.',
  }),
  req('Viewer can list -> 200', 'GET', T, { auth: 'viewerToken', tests: 'expectOk(200);' }),
  req('Viewer cannot create -> 403', 'POST', T, {
    auth: 'viewerToken', body: { name: 'Nope' }, tests: 'expectError(403, "INSUFFICIENT_ROLE");',
  }),
));

const bigBody = `pm.request.body.update(JSON.stringify({ name: "Too big", description: "x".repeat(300000) }));`;

const create = folder('02 - Create theme', 'POST /api/v1/themes', items(
  req('Create DRAFT (partial config)', 'POST', T, {
    body: {
      name: 'Postman Ocean {{runId}}',
      description: 'Created by the Postman collection',
      config: { colors: { primary: '#2563EB', background: '#FFFFFF' } },
    },
    tests: `
expectOk(201);
pm.test("is a DRAFT at version 1 with string id", () => {
  const d = j().data;
  pm.expect(d.status).to.eql("DRAFT");
  pm.expect(d.version).to.eql(1);
  pm.expect(d.id).to.be.a("string");
  pm.expect(d.workspaceId).to.eql(pm.environment.get("workspaceId"));
  pm.expect(d.createdBy).to.eql(pm.environment.get("userId"));
  pm.expect(d.config.schemaVersion).to.eql(1);
  pm.expect(d.slug).to.match(/^postman-ocean-/);
});
pm.test("ETag and Location headers", () => {
  pm.expect(pm.response.headers.get("ETag")).to.eql('"1"');
  pm.expect(pm.response.headers.get("Location")).to.eql("/api/v1/themes/" + j().data.id);
});
${setVar('themeId', 'j().data.id')}
${setVar('themeSlug', 'j().data.slug')}
${setVar('expectedVersion', 'j().data.version')}
`,
  }),
  req('Create with same name -> auto-suffixed slug', 'POST', T, {
    body: { name: 'Postman Ocean {{runId}}' },
    tests: `
expectOk(201);
pm.test("slug auto-suffixed", () => pm.expect(j().data.slug).to.eql(pm.environment.get("themeSlug") + "-2"));
${setVar('secondThemeId', 'j().data.id')}
`,
  }),
  req('Create with duplicate explicit slug -> 409', 'POST', T, {
    body: { name: 'Another', slug: '{{themeSlug}}' }, tests: 'expectError(409, "THEME_SLUG_CONFLICT");',
  }),
  req('Empty name -> 400', 'POST', T, { body: { name: '   ' }, tests: 'expectError(400, "VALIDATION_ERROR");' }),
  req('Actor id in body is rejected -> 400', 'POST', T, {
    body: { name: 'Sneaky', createdBy: '999' }, tests: 'expectError(400, "VALIDATION_ERROR");\nhasDetail("body.createdBy", "UNKNOWN_KEY");',
  }),
  req('Workspace id in body is rejected -> 400', 'POST', T, {
    body: { name: 'Sneaky', workspaceId: '2' }, tests: 'expectError(400, "VALIDATION_ERROR");',
  }),
  req('Invalid slug format -> 400', 'POST', T, { body: { name: 'X', slug: 'Bad Slug!' }, tests: 'expectError(400, "VALIDATION_ERROR");' }),
  req('Malformed JSON -> 400', 'POST', T, { body: '{"name": ', tests: 'expectError(400, "INVALID_JSON");' }),
  req('Oversized body -> 413', 'POST', T, { body: { name: 'x' }, pre: bigBody, tests: 'expectError(413, "PAYLOAD_TOO_LARGE");' }),
  req('Unknown config key -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { evil: { script: '<script>alert(1)</script>' } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("evil", "UNKNOWN_KEY");',
  }),
  req('Unknown device key (mobile) -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { typography: { h1: { fontSize: { base: '40px', mobile: '28px' } } } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("typography.h1.fontSize.mobile", "UNKNOWN_KEY");',
  }),
  req('Unsafe CSS value -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { colors: { primary: 'url(javascript:alert(1))' } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("colors.primary", "INVALID_VALUE");',
  }),
  req('Out-of-range spacing -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { spacing: { md: '9999px' } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("spacing.md", "INVALID_VALUE");',
  }),
  req('Missing token reference -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { colors: { primary: '{colors.nope}' } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("colors.primary", "REF_MISSING");',
  }),
  req('Cyclic token reference -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { colors: { primary: '{colors.secondary}', secondary: '{colors.primary}' } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("colors.primary", "REF_CYCLE");',
  }),
  req('Unordered gradient stops -> 422', 'POST', T, {
    body: {
      name: 'Bad {{runId}}',
      config: { backgrounds: { page: { type: 'gradient', angle: 90, stops: [{ color: '#000000', position: 80 }, { color: '#FFFFFF', position: 10 }] } } },
    },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("backgrounds.page.stops[1].position", "GRADIENT_STOPS_UNORDERED");',
  }),
  req('Image background must reference a Media asset id -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { backgrounds: { page: { type: 'image', assetId: 'http://evil/x.png' } } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("backgrounds.page.assetId");',
  }),
  req('Fixed breakpoints cannot be changed -> 422', 'POST', T, {
    body: { name: 'Bad {{runId}}', config: { responsive: { breakpoints: { phone: { maxWidth: 600 }, tablet: { minWidth: 601, maxWidth: 1023 }, laptop: { minWidth: 1024 } } } } },
    tests: 'expectError(422, "THEME_CONFIG_INVALID");',
  }),
));

const read = folder('03 - List & get', 'GET /api/v1/themes, GET /api/v1/themes/:id', items(
  req('List themes', 'GET', T, {
    tests: `
expectOk(200);
pm.test("contains created theme; list items omit config", () => {
  const item = j().data.find((t) => t.id === pm.environment.get("themeId"));
  pm.expect(item).to.be.an("object");
  pm.expect(item).to.not.have.property("config");
  pm.expect(item.status).to.eql("DRAFT");
});
pm.test("pagination meta", () => {
  const p = j().meta.pagination;
  pm.expect(p.page).to.eql(1);
  pm.expect(p.pageSize).to.eql(20);
  pm.expect(p.total).to.be.at.least(2);
});
`,
  }),
  req('List: search by slug', 'GET', `${T}?search={{themeSlug}}`, {
    tests: 'expectOk(200);\npm.test("finds both same-name themes", () => pm.expect(j().data.length).to.be.at.least(2));',
  }),
  req('List: status filter DRAFT', 'GET', `${T}?status=DRAFT`, {
    tests: 'expectOk(200);\npm.test("only drafts", () => j().data.forEach((t) => pm.expect(t.status).to.eql("DRAFT")));',
  }),
  req('List: pageSize=1 (pagination)', 'GET', `${T}?pageSize=1&page=1`, {
    tests: 'expectOk(200);\npm.test("one item, multiple pages", () => {\n  pm.expect(j().data.length).to.eql(1);\n  pm.expect(j().meta.pagination.totalPages).to.be.at.least(2);\n});',
  }),
  req('List: pageSize=101 -> 400', 'GET', `${T}?pageSize=101`, { tests: 'expectError(400, "VALIDATION_ERROR");' }),
  req('List: page=0 -> 400', 'GET', `${T}?page=0`, { tests: 'expectError(400, "VALIDATION_ERROR");' }),
  req('List: bogus status -> 400', 'GET', `${T}?status=BOGUS`, { tests: 'expectError(400, "VALIDATION_ERROR");' }),
  req('Get theme', 'GET', `${T}/{{themeId}}`, {
    tests: `
expectOk(200);
pm.test("full theme returned", () => {
  const d = j().data;
  pm.expect(d.id).to.eql(pm.environment.get("themeId"));
  pm.expect(d.config.colors.primary).to.eql("#2563EB");
  pm.expect(d).to.have.property("archivedAt", null);
});
pm.test("ETag matches version", () => pm.expect(pm.response.headers.get("ETag")).to.eql('"' + j().data.version + '"'));
`,
  }),
  req('Get with non-numeric id -> 400', 'GET', `${T}/abc`, { tests: 'expectError(400, "VALIDATION_ERROR");' }),
  req('Get unknown id -> 404', 'GET', `${T}/999999999999`, { tests: 'expectError(404, "NOT_FOUND");' }),
));

const update = folder('04 - Update (PATCH, optimistic locking)', 'PATCH /api/v1/themes/:id', items(
  req('Missing expectedVersion -> 400', 'PATCH', `${T}/{{themeId}}`, {
    body: { name: 'Renamed' }, tests: 'expectError(400, "EXPECTED_VERSION_REQUIRED");',
  }),
  req('Empty patch -> 400', 'PATCH', `${T}/{{themeId}}`, {
    body: '{ "expectedVersion": {{expectedVersion}} }', tests: 'expectError(400, "VALIDATION_ERROR");',
  }),
  req('Actor id in body -> 400', 'PATCH', `${T}/{{themeId}}`, {
    body: '{ "expectedVersion": {{expectedVersion}}, "name": "x", "updatedBy": "999" }', tests: 'expectError(400, "VALIDATION_ERROR");',
  }),
  req('Apply complete configuration (v1 -> v2)', 'PATCH', `${T}/{{themeId}}`, {
    body: `{ "expectedVersion": {{expectedVersion}}, "config": ${JSON.stringify(fullTheme())} }`,
    tests: `
expectOk(200);
pm.test("version incremented, config persisted/round-trips", () => {
  const d = j().data;
  pm.expect(d.version).to.eql(2);
  pm.expect(d.config.typography.h1.fontSize).to.eql({ base: "48px", tablet: "40px", phone: "32px" });
  pm.expect(d.config.buttons.primary.radius).to.eql("{radius.md}");
  pm.expect(d.config.layout.containerWidth.tablet).to.eql("960px");
  pm.expect(d.updatedBy).to.eql(pm.environment.get("userId"));
});
${setVar('expectedVersion', 'j().data.version')}
`,
  }),
  req('Partial patch keeps unrelated config (merge)', 'PATCH', `${T}/{{themeId}}`, {
    body: '{ "expectedVersion": {{expectedVersion}}, "config": { "colors": { "primary": "#1D4ED8" } } }',
    tests: `
expectOk(200);
pm.test("only primary changed; everything else preserved", () => {
  const c = j().data.config;
  pm.expect(c.colors.primary).to.eql("#1D4ED8");
  pm.expect(c.colors.secondary).to.eql("#7C3AED");
  pm.expect(c.typography.h1.fontWeight).to.eql(700);
  pm.expect(c.spacing.md).to.eql("16px");
});
pm.test("version is 3", () => pm.expect(j().data.version).to.eql(3));
${setVar('expectedVersion', 'j().data.version')}
`,
  }),
  req('null removes a key (merge patch)', 'PATCH', `${T}/{{themeId}}`, {
    body: '{ "expectedVersion": {{expectedVersion}}, "config": { "colors": { "accent": null } } }',
    tests: `
expectOk(200);
pm.test("accent removed, others kept", () => {
  pm.expect(j().data.config.colors).to.not.have.property("accent");
  pm.expect(j().data.config.colors.primary).to.eql("#1D4ED8");
});
${setVar('expectedVersion', 'j().data.version')}
`,
  }),
  req('Stale expectedVersion -> 409', 'PATCH', `${T}/{{themeId}}`, {
    body: { expectedVersion: 1, name: 'Stale write' },
    tests: `
expectError(409, "THEME_VERSION_CONFLICT");
pm.test("conflict details", () => {
  pm.expect(j().error.details.expectedVersion).to.eql(1);
  pm.expect(j().error.details.currentVersion).to.eql(Number(pm.environment.get("expectedVersion")));
});
`,
  }),
  req('Invalid config -> 422 and version unchanged', 'PATCH', `${T}/{{themeId}}`, {
    body: '{ "expectedVersion": {{expectedVersion}}, "config": { "colors": { "primary": "red; background:url(x)" } } }',
    tests: 'expectError(422, "THEME_CONFIG_INVALID");\nhasDetail("colors.primary", "INVALID_VALUE");',
  }),
  req('Version unchanged after failed patch', 'GET', `${T}/{{themeId}}`, {
    tests: 'expectOk(200);\npm.test("version still equals expectedVersion", () => pm.expect(j().data.version).to.eql(Number(pm.environment.get("expectedVersion"))));',
  }),
  req('If-Match header and body disagree -> 400', 'PATCH', `${T}/{{themeId}}`, {
    headers: { 'If-Match': '"999"' }, body: '{ "expectedVersion": {{expectedVersion}}, "name": "x" }',
    tests: 'expectError(400, "VALIDATION_ERROR");',
  }),
  req('Rename using If-Match header (no body version)', 'PATCH', `${T}/{{themeId}}`, {
    headers: { 'If-Match': '"{{expectedVersion}}"' },
    body: { name: 'Postman Ocean Renamed {{runId}}', description: 'Updated via If-Match' },
    tests: `
expectOk(200);
pm.test("renamed; slug unchanged", () => {
  pm.expect(j().data.name).to.include("Renamed");
  pm.expect(j().data.slug).to.eql(pm.environment.get("themeSlug"));
});
${setVar('expectedVersion', 'j().data.version')}
`,
  }),
));

const lifecycle = folder('05 - Validate, activate, duplicate', 'Lifecycle: DRAFT -> ACTIVE, duplicate to a new DRAFT.', items(
  req('Create incomplete draft', 'POST', T, {
    body: { name: 'Incomplete {{runId}}', config: { colors: { primary: '#2563EB' } } },
    tests: `
expectOk(201);
${setVar('incompleteId', 'j().data.id')}
${setVar('incompleteSlug', 'j().data.slug')}
${setVar('incompleteVersion', 'j().data.version')}
`,
  }),
  req('Validate incomplete theme -> valid=false', 'POST', `${T}/{{incompleteId}}/validate`, {
    tests: `
expectOk(200);
pm.test("not valid; reports missing required paths", () => {
  const d = j().data;
  pm.expect(d.valid).to.eql(false);
  pm.expect(d.errors.some((e) => e.path === "colors.secondary" && e.code === "REQUIRED_FOR_ACTIVATION")).to.eql(true);
});
`,
  }),
  req('Activate incomplete theme -> 422', 'POST', `${T}/{{incompleteId}}/activate`, {
    tests: 'expectError(422, "THEME_ACTIVATION_INVALID");\nhasDetail("typography.h1.fontSize", "REQUIRED_FOR_ACTIVATION");',
  }),
  req('Create complete draft', 'POST', T, {
    body: { name: 'Complete {{runId}}', config: fullTheme() },
    tests: `
expectOk(201);
${setVar('completeId', 'j().data.id')}
${setVar('completeSlug', 'j().data.slug')}
${setVar('completeVersion', 'j().data.version')}
`,
  }),
  req('Validate complete theme -> valid=true', 'POST', `${T}/{{completeId}}/validate`, {
    tests: `
expectOk(200);
pm.test("valid with no errors", () => {
  pm.expect(j().data.valid).to.eql(true);
  pm.expect(j().data.errors).to.eql([]);
  pm.expect(j().data.warnings).to.be.an("array");
});
`,
  }),
  req('Activate as editor -> 403 (admin required)', 'POST', `${T}/{{completeId}}/activate`, {
    auth: 'editorToken', tests: 'expectError(403, "INSUFFICIENT_ROLE");',
  }),
  req('Activate with stale expectedVersion -> 409', 'POST', `${T}/{{completeId}}/activate`, {
    body: { expectedVersion: 99 }, tests: 'expectError(409, "THEME_VERSION_CONFLICT");',
  }),
  req('Activate complete theme', 'POST', `${T}/{{completeId}}/activate`, {
    body: '{ "expectedVersion": {{completeVersion}} }',
    tests: `
expectOk(200);
pm.test("ACTIVE, version incremented", () => {
  pm.expect(j().data.status).to.eql("ACTIVE");
  pm.expect(j().data.version).to.eql(Number(pm.environment.get("completeVersion")) + 1);
});
${setVar('completeVersion', 'j().data.version')}
`,
  }),
  req('Edit ACTIVE theme -> 409 (draft-first policy)', 'PATCH', `${T}/{{completeId}}`, {
    body: '{ "expectedVersion": {{completeVersion}}, "name": "Live edit" }', tests: 'expectError(409, "THEME_NOT_EDITABLE");',
  }),
  req('Activate again -> 409', 'POST', `${T}/{{completeId}}/activate`, { tests: 'expectError(409, "THEME_LIFECYCLE_CONFLICT");' }),
  req('Duplicate ACTIVE theme -> new DRAFT', 'POST', `${T}/{{completeId}}/duplicate`, {
    tests: `
expectOk(201);
pm.test("new DRAFT, version 1, new identity, same visual config", () => {
  const d = j().data;
  pm.expect(d.id).to.not.eql(pm.environment.get("completeId"));
  pm.expect(d.status).to.eql("DRAFT");
  pm.expect(d.version).to.eql(1);
  pm.expect(d.name).to.match(/\\(Copy\\)$/);
  pm.expect(d.slug).to.not.eql(pm.environment.get("completeSlug"));
  pm.expect(d.createdBy).to.eql(pm.environment.get("userId"));
});
${setVar('duplicateId', 'j().data.id')}
`,
  }),
  req('Duplicate has identical config to source', 'GET', `${T}/{{duplicateId}}`, {
    pre: `pm.sendRequest({ url: pm.environment.get("baseUrl") + "/api/v1/themes/" + pm.environment.get("completeId"), method: "GET", header: { Authorization: "Bearer " + pm.environment.get("token"), "X-Workspace-Id": pm.environment.get("workspaceId") } }, (err, res) => { pm.environment.set("sourceConfigJson", JSON.stringify(res.json().data.config)); });`,
    tests: `
expectOk(200);
pm.test("config deep-equals source", () => pm.expect(JSON.stringify(j().data.config)).to.eql(pm.environment.get("sourceConfigJson")));
`,
  }),
  req('Duplicate with custom name', 'POST', `${T}/{{completeId}}/duplicate`, {
    body: { name: 'Dark Variant {{runId}}' },
    tests: 'expectOk(201);\npm.test("custom name used", () => pm.expect(j().data.name).to.eql("Dark Variant " + pm.environment.get("runId")));',
  }),
  req('Duplicate as viewer -> 403', 'POST', `${T}/{{completeId}}/duplicate`, { auth: 'viewerToken', tests: 'expectError(403, "INSUFFICIENT_ROLE");' }),
));

const isolation = folder('06 - Workspace isolation', 'A caller from another workspace must not see or change this workspace\'s themes.', items(
  req('Other workspace: GET -> 404', 'GET', `${T}/{{completeId}}`, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', tests: 'expectError(404, "NOT_FOUND");',
  }),
  req('Other workspace: list does not leak', 'GET', T, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}',
    tests: 'expectOk(200);\npm.test("does not contain this workspace\'s themes", () => {\n  const ids = j().data.map((t) => t.id);\n  pm.expect(ids).to.not.include(pm.environment.get("completeId"));\n  pm.expect(ids).to.not.include(pm.environment.get("themeId"));\n});',
  }),
  req('Other workspace: PATCH -> 404', 'PATCH', `${T}/{{themeId}}`, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', body: { expectedVersion: 1, name: 'Hijack' }, tests: 'expectError(404, "NOT_FOUND");',
  }),
  req('Other workspace: validate -> 404', 'POST', `${T}/{{completeId}}/validate`, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', tests: 'expectError(404, "NOT_FOUND");',
  }),
  req('Other workspace: activate -> 404', 'POST', `${T}/{{themeId}}/activate`, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', tests: 'expectError(404, "NOT_FOUND");',
  }),
  req('Other workspace: duplicate -> 404', 'POST', `${T}/{{completeId}}/duplicate`, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', tests: 'expectError(404, "NOT_FOUND");',
  }),
  req('Other workspace: archive -> 404', 'DELETE', `${T}/{{completeId}}`, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', tests: 'expectError(404, "NOT_FOUND");',
  }),
  req('Other workspace may reuse the same slug (slugs are per workspace)', 'POST', T, {
    auth: 'otherToken', workspace: '{{otherWorkspaceId}}', body: { name: 'Ocean', slug: '{{themeSlug}}' },
    tests: 'expectOk(201);\npm.test("created in the other workspace", () => {\n  pm.expect(j().data.workspaceId).to.eql(pm.environment.get("otherWorkspaceId"));\n  pm.expect(j().data.slug).to.eql(pm.environment.get("themeSlug"));\n});',
  }),
  req('Original theme untouched', 'GET', `${T}/{{completeId}}`, {
    tests: 'expectOk(200);\npm.test("still ACTIVE with the same name", () => {\n  pm.expect(j().data.status).to.eql("ACTIVE");\n  pm.expect(j().data.name).to.eql("Complete " + pm.environment.get("runId"));\n});',
  }),
));

const archive = folder('07 - Archive (soft delete)', 'DELETE /api/v1/themes/:id', items(
  req('Archive as editor -> 403 (admin required)', 'DELETE', `${T}/{{incompleteId}}`, { auth: 'editorToken', tests: 'expectError(403, "INSUFFICIENT_ROLE");' }),
  req('Archive with stale If-Match -> 409', 'DELETE', `${T}/{{incompleteId}}`, {
    headers: { 'If-Match': '"99"' }, tests: 'expectError(409, "THEME_VERSION_CONFLICT");',
  }),
  req('Archive draft', 'DELETE', `${T}/{{incompleteId}}`, {
    tests: `
expectOk(200);
pm.test("ARCHIVED with archivedAt, version incremented", () => {
  pm.expect(j().data.status).to.eql("ARCHIVED");
  pm.expect(j().data.archivedAt).to.be.a("string");
  pm.expect(j().data.version).to.eql(Number(pm.environment.get("incompleteVersion")) + 1);
});
`,
  }),
  req('Archive again -> 409', 'DELETE', `${T}/{{incompleteId}}`, { tests: 'expectError(409, "THEME_LIFECYCLE_CONFLICT");' }),
  req('Default list excludes archived', 'GET', `${T}?search={{incompleteSlug}}`, {
    tests: 'expectOk(200);\npm.test("archived theme hidden", () => pm.expect(j().data.map((t) => t.id)).to.not.include(pm.environment.get("incompleteId")));',
  }),
  req('List status=ARCHIVED includes it', 'GET', `${T}?status=ARCHIVED&search={{incompleteSlug}}`, {
    tests: 'expectOk(200);\npm.test("archived theme listed", () => pm.expect(j().data.map((t) => t.id)).to.include(pm.environment.get("incompleteId")));',
  }),
  req('Archived theme is still readable', 'GET', `${T}/{{incompleteId}}`, {
    tests: 'expectOk(200);\npm.test("ARCHIVED", () => pm.expect(j().data.status).to.eql("ARCHIVED"));',
  }),
  req('Edit archived -> 409', 'PATCH', `${T}/{{incompleteId}}`, {
    body: { expectedVersion: 2, name: 'Zombie' }, tests: 'expectError(409, "THEME_NOT_EDITABLE");',
  }),
  req('Archived slug stays reserved -> 409', 'POST', T, {
    body: { name: 'Reuse', slug: '{{incompleteSlug}}' }, tests: 'expectError(409, "THEME_SLUG_CONFLICT");',
  }),
  req('Archive ACTIVE theme', 'DELETE', `${T}/{{completeId}}`, {
    tests: 'expectOk(200);\npm.test("ARCHIVED", () => pm.expect(j().data.status).to.eql("ARCHIVED"));',
  }),
));

const collection = {
  info: {
    name: 'Theme API',
    description:
      'Theme API - visual theme service. Every request sends "Authorization: Bearer {{token}}" (JWT signed from {{jwtSecret}} by the collection pre-request script), "X-Workspace-Id" and "X-Request-Id". Run in order (folders 00-07); later requests reuse ids saved by earlier ones.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: COLLECTION_PRE_REQUEST.split('\n') } }],
  item: [ops, authFolder, create, read, update, lifecycle, isolation, archive],
};

// ---------------------------------------------------------------- environments

function environment(name, secret) {
  const v = (key, value, type = 'default') => ({ key, value, type, enabled: true });
  return {
    id: `theme-api-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    values: [
      v('baseUrl', 'http://localhost:4065'),
      v('jwtSecret', secret, 'secret'),
      v('userId', '1001'),
      v('workspaceId', '1'),
      v('otherWorkspaceId', '2'),
      v('internalServiceToken', ''),
      // Written by the pre-request script / tests:
      ...['token', 'editorToken', 'viewerToken', 'otherToken', 'expiredToken', 'badSigToken', 'algNoneToken', 'requestId', 'runId',
        'themeId', 'themeSlug', 'secondThemeId', 'expectedVersion', 'incompleteId', 'incompleteSlug', 'incompleteVersion',
        'completeId', 'completeSlug', 'completeVersion', 'duplicateId', 'sourceConfigJson'].map((k) => v(k, '')),
    ],
    _postman_variable_scope: 'environment',
  };
}

fs.mkdirSync(outDir, { recursive: true });
const write = (file, data) => fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(data, null, 2)}\n`);
write('Theme-API.postman_collection.json', collection);
write('Theme-API.postman_environment.json', environment('Theme API - Local (template)', 'replace-with-JWT_SECRET-from-your-.env'));
const secret = readEnvSecret();
if (secret) {
  write('Theme-API.local.postman_environment.json', environment('Theme API - Local', secret));
  console.log('Wrote collection, template environment and local environment (git-ignored).');
} else {
  console.log('Wrote collection and template environment. No .env found, so no local environment was generated.');
}


