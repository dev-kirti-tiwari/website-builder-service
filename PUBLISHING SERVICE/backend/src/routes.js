const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { q, tx } = require('./db');
const { authenticate, requirePermission } = require('./auth');
const { ApiError, wrap } = require('./errors');
const { idempotent } = require('./idempotency');
const { sha256, stableStringify, requireId, validateContent } = require('./util');
const { depDto, relDto, audit, getWebsite, getDeployment, activateRelease } = require('./service');

const router = express.Router();
const read = requirePermission('publishing:read');
const write = requirePermission('publishing:write');

router.use(authenticate);
for (const p of ['websiteId', 'deploymentId', 'sessionId']) {
  router.param(p, (_req, _res, next, v) => { requireId(v, p); next(); });
}

const page = (req) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return { limit, offset };
};

async function loadRevision(c, websiteId, revisionId) {
  requireId(revisionId, 'revisionId');
  const { rows } = await c.query('SELECT * FROM wb_revisions WHERE id=$1 AND website_id=$2', [revisionId, websiteId]);
  if (!rows[0]) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found for this website.');
  return rows[0];
}

// ---- validate (no side effects) -------------------------------------------------------------
router.post('/websites/:websiteId/validate-publish', read, wrap(async (req, res) => {
  await getWebsite({ query: q }, req.ctx, req.params.websiteId);
  const rev = await loadRevision({ query: q }, req.params.websiteId, req.body && req.body.revisionId);
  const errors = validateContent(rev.content);
  res.json({ websiteId: req.params.websiteId, revisionId: rev.id, valid: errors.length === 0, errors });
}));

// ---- publish ----------------------------------------------------------------------------------
router.post('/websites/:websiteId/publish', write, wrap((req, res) => idempotent(req, res, async (c) => {
  const { ctx } = req;
  const { revisionId, reason } = req.body || {};
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
    throw new ApiError(400, 'INVALID_REASON', 'reason must be a string of at most 500 characters.');
  }
  const website = await getWebsite(c, ctx, req.params.websiteId, true);
  const rev = await loadRevision(c, website.id, revisionId);

  const errors = validateContent(rev.content);
  if (errors.length) throw new ApiError(422, 'VALIDATION_FAILED', 'Revision cannot be published.', errors);

  const busy = await c.query(
    "SELECT 1 FROM publishing_deployments WHERE website_id=$1 AND status NOT IN ('succeeded','failed') LIMIT 1", [website.id]);
  if (busy.rowCount) throw new ApiError(409, 'DEPLOYMENT_IN_PROGRESS', 'Another deployment is in progress for this website.');

  // Freeze input: the release owns an immutable snapshot + content hash.
  const hash = sha256(stableStringify(rev.content));
  const rel = await c.query(
    `INSERT INTO publishing_releases (tenant_id, organization_id, website_id, revision_id, snapshot, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ctx.tenantId, ctx.orgId, website.id, rev.id, JSON.stringify(rev.content), hash]);
  const dep = await c.query(
    `INSERT INTO publishing_deployments
       (tenant_id, organization_id, website_id, revision_id, release_id, kind, requested_by, reason)
     VALUES ($1,$2,$3,$4,$5,'publish',$6,$7) RETURNING *`,
    [ctx.tenantId, ctx.orgId, website.id, rev.id, rel.rows[0].id, ctx.userId, reason || null]);
  await c.query('UPDATE publishing_releases SET deployment_id=$2 WHERE id=$1', [rel.rows[0].id, dep.rows[0].id]);
  // Deployment record and outbox intent commit atomically with the idempotency key.
  await c.query("INSERT INTO publishing_outbox_events (event_type, aggregate_id) VALUES ('deployment.requested',$1)", [dep.rows[0].id]);
  await audit(c, ctx, website.id, 'publish.requested', { deploymentId: dep.rows[0].id, revisionId: rev.id });

  const d = depDto(dep.rows[0]);
  return { status: 202, body: { deploymentId: d.deploymentId, websiteId: d.websiteId, revisionId: d.revisionId, status: d.status, createdAt: d.createdAt } };
})));

// ---- status / history ---------------------------------------------------------------------------
router.get('/websites/:websiteId/publishing-status', read, wrap(async (req, res) => {
  const w = await getWebsite({ query: q }, req.ctx, req.params.websiteId);
  const [active, latest] = await Promise.all([
    w.active_release_id ? q('SELECT * FROM publishing_releases WHERE id=$1', [w.active_release_id]) : { rows: [] },
    q('SELECT * FROM publishing_deployments WHERE website_id=$1 ORDER BY id DESC LIMIT 1', [w.id]),
  ]);
  res.json({
    websiteId: w.id,
    state: w.status,
    activeRelease: active.rows[0] ? relDto(active.rows[0]) : null,
    latestDeployment: latest.rows[0] ? depDto(latest.rows[0]) : null,
  });
}));

router.get('/websites/:websiteId/deployments', read, wrap(async (req, res) => {
  const w = await getWebsite({ query: q }, req.ctx, req.params.websiteId);
  const { limit, offset } = page(req);
  const { rows } = await q('SELECT * FROM publishing_deployments WHERE website_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3', [w.id, limit, offset]);
  res.json({ items: rows.map(depDto), limit, offset });
}));

router.get('/websites/:websiteId/releases', read, wrap(async (req, res) => {
  const w = await getWebsite({ query: q }, req.ctx, req.params.websiteId);
  const { limit, offset } = page(req);
  const { rows } = await q('SELECT * FROM publishing_releases WHERE website_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3', [w.id, limit, offset]);
  res.json({ items: rows.map(relDto), limit, offset });
}));

router.get('/deployments/:deploymentId', read, wrap(async (req, res) => {
  const d = await getDeployment({ query: q }, req.ctx, req.params.deploymentId);
  const attempts = await q(
    'SELECT attempt_number, status, error_code, started_at, ended_at FROM publishing_deployment_attempts WHERE deployment_id=$1 ORDER BY attempt_number',
    [d.id]);
  res.json({
    ...depDto(d),
    attempts: attempts.rows.map((a) => ({
      attemptNumber: a.attempt_number, status: a.status, errorCode: a.error_code, startedAt: a.started_at, endedAt: a.ended_at,
    })),
  });
}));

// Redacted diagnostics: only stage names and fixed safe messages are ever stored.
router.get('/deployments/:deploymentId/logs', read, wrap(async (req, res) => {
  const d = await getDeployment({ query: q }, req.ctx, req.params.deploymentId);
  const { rows } = await q('SELECT stage, message, created_at FROM publishing_deployment_events WHERE deployment_id=$1 ORDER BY id', [d.id]);
  res.json({ deploymentId: d.id, events: rows.map((e) => ({ stage: e.stage, message: e.message, at: e.created_at })) });
}));

// ---- retry ----------------------------------------------------------------------------------------
router.post('/deployments/:deploymentId/retry', write, wrap((req, res) => idempotent(req, res, async (c) => {
  const d = await getDeployment(c, req.ctx, req.params.deploymentId, true);
  if (d.kind !== 'publish' || d.status !== 'failed') {
    throw new ApiError(409, 'NOT_RETRYABLE', 'Only failed publish deployments can be retried.');
  }
  const n = await c.query('SELECT count(*)::int AS n FROM publishing_deployment_attempts WHERE deployment_id=$1', [d.id]);
  if (n.rows[0].n >= config.maxRetries) throw new ApiError(409, 'RETRIES_EXHAUSTED', 'Maximum attempts reached.');
  const busy = await c.query(
    "SELECT 1 FROM publishing_deployments WHERE website_id=$1 AND id<>$2 AND status NOT IN ('succeeded','failed') LIMIT 1", [d.website_id, d.id]);
  if (busy.rowCount) throw new ApiError(409, 'DEPLOYMENT_IN_PROGRESS', 'Another deployment is in progress for this website.');

  const upd = await c.query(
    "UPDATE publishing_deployments SET status='queued', error_code=NULL, updated_at=now() WHERE id=$1 RETURNING *", [d.id]);
  await c.query("INSERT INTO publishing_outbox_events (event_type, aggregate_id) VALUES ('deployment.requested',$1)", [d.id]);
  await audit(c, req.ctx, d.website_id, 'deployment.retried', { deploymentId: d.id });
  const out = depDto(upd.rows[0]);
  return { status: 202, body: { deploymentId: out.deploymentId, websiteId: out.websiteId, revisionId: out.revisionId, status: out.status, createdAt: out.createdAt } };
})));

// ---- rollback / unpublish (immediate pointer switches, history preserved) ----------------------------
router.post('/websites/:websiteId/rollback', write, wrap((req, res) => idempotent(req, res, async (c) => {
  const { ctx } = req;
  const { releaseId, reason } = req.body || {};
  requireId(releaseId, 'releaseId');
  const website = await getWebsite(c, ctx, req.params.websiteId, true);
  const { rows } = await c.query('SELECT * FROM publishing_releases WHERE id=$1 AND website_id=$2', [releaseId, website.id]);
  const target = rows[0];
  if (!target) throw new ApiError(404, 'RELEASE_NOT_FOUND', 'Release not found.');
  if (target.status === 'active') throw new ApiError(409, 'ALREADY_ACTIVE', 'Release is already active.');
  if (target.status !== 'superseded') throw new ApiError(409, 'NOT_ROLLBACK_TARGET', 'Only previously active releases can be restored.');

  await activateRelease(c, website.id, target.id);
  const dep = await c.query(
    `INSERT INTO publishing_deployments
       (tenant_id, organization_id, website_id, revision_id, release_id, kind, status, propagation_status, requested_by, reason)
     VALUES ($1,$2,$3,$4,$5,'rollback','succeeded','completed',$6,$7) RETURNING *`,
    [ctx.tenantId, ctx.orgId, website.id, target.revision_id, target.id, ctx.userId, reason || null]);
  await audit(c, ctx, website.id, 'release.rolled_back', { releaseId: target.id, previousReleaseId: website.active_release_id });
  return { status: 200, body: depDto(dep.rows[0]) };
})));

router.post('/websites/:websiteId/unpublish', write, wrap((req, res) => idempotent(req, res, async (c) => {
  const { ctx } = req;
  const website = await getWebsite(c, ctx, req.params.websiteId, true);
  if (!website.active_release_id) throw new ApiError(409, 'NOT_PUBLISHED', 'Website is not currently published.');
  const rel = (await c.query('SELECT * FROM publishing_releases WHERE id=$1', [website.active_release_id])).rows[0];
  await c.query("UPDATE publishing_releases SET status='superseded' WHERE id=$1", [rel.id]);
  await c.query("UPDATE wb_websites SET active_release_id=NULL, status='unpublished', updated_at=now() WHERE id=$1", [website.id]);
  const dep = await c.query(
    `INSERT INTO publishing_deployments
       (tenant_id, organization_id, website_id, revision_id, release_id, kind, status, propagation_status, requested_by, reason)
     VALUES ($1,$2,$3,$4,$5,'unpublish','succeeded','completed',$6,$7) RETURNING *`,
    [ctx.tenantId, ctx.orgId, website.id, rel.revision_id, rel.id, ctx.userId, (req.body && req.body.reason) || null]);
  await audit(c, ctx, website.id, 'website.unpublished', { releaseId: rel.id });
  return { status: 200, body: depDto(dep.rows[0]) };
})));

// ---- preview sessions ---------------------------------------------------------------------------------
const previewDto = (r) => ({
  sessionId: r.id,
  websiteId: r.website_id,
  revisionId: r.revision_id,
  status: r.revoked_at ? 'revoked' : new Date(r.expires_at) <= new Date() ? 'expired' : 'active',
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

router.post('/websites/:websiteId/preview-sessions', write, wrap(async (req, res) => {
  const { ctx } = req;
  const { revisionId, ttlSeconds = 3600 } = req.body || {};
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) {
    throw new ApiError(400, 'INVALID_TTL', 'ttlSeconds must be an integer between 60 and 86400.');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const row = await tx(async (c) => {
    const website = await getWebsite(c, ctx, req.params.websiteId);
    const rev = await loadRevision(c, website.id, revisionId);
    const ins = await c.query(
      `INSERT INTO publishing_preview_sessions
         (tenant_id, organization_id, website_id, revision_id, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7)) RETURNING *`,
      [ctx.tenantId, ctx.orgId, website.id, rev.id, sha256(token), ctx.userId, ttlSeconds]);
    await audit(c, ctx, website.id, 'preview.created', { sessionId: ins.rows[0].id });
    return ins.rows[0];
  });
  // The raw token is returned once; only its hash is stored.
  res.json({ ...previewDto(row), token });
}));

async function getPreview(c, ctx, id) {
  const { rows } = await c.query(
    'SELECT * FROM publishing_preview_sessions WHERE id=$1 AND tenant_id=$2 AND organization_id=$3', [id, ctx.tenantId, ctx.orgId]);
  if (!rows[0]) throw new ApiError(404, 'PREVIEW_NOT_FOUND', 'Preview session not found.');
  return rows[0];
}

router.get('/preview-sessions/:sessionId', read, wrap(async (req, res) => {
  res.json(previewDto(await getPreview({ query: q }, req.ctx, req.params.sessionId)));
}));

router.delete('/preview-sessions/:sessionId', write, wrap(async (req, res) => {
  await getPreview({ query: q }, req.ctx, req.params.sessionId);
  const { rows } = await q(
    'UPDATE publishing_preview_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id=$1 RETURNING *', [req.params.sessionId]);
  res.json(previewDto(rows[0]));
}));

module.exports = { router };
