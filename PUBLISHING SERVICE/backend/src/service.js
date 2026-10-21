const { ApiError } = require('./errors');

const depDto = (r) => ({
  deploymentId: r.id,
  websiteId: r.website_id,
  revisionId: r.revision_id,
  releaseId: r.release_id,
  kind: r.kind,
  status: r.status,
  propagationStatus: r.propagation_status,
  errorCode: r.error_code,
  reason: r.reason,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const relDto = (r) => ({
  releaseId: r.id,
  websiteId: r.website_id,
  revisionId: r.revision_id,
  deploymentId: r.deployment_id,
  contentHash: r.content_hash,
  status: r.status,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
});

const audit = (c, ctx, websiteId, action, metadata = {}) => c.query(
  `INSERT INTO publishing_audit_logs (tenant_id, organization_id, website_id, actor, action, metadata)
   VALUES ($1,$2,$3,$4,$5,$6)`,
  [ctx.tenantId, ctx.orgId, websiteId, ctx.userId, action, JSON.stringify(metadata)]);

// Every lookup is scoped by tenant AND organization; foreign ids look exactly like missing ones (404).
async function getWebsite(c, ctx, id, lock = false) {
  const { rows } = await c.query(
    `SELECT * FROM wb_websites WHERE id=$1 AND tenant_id=$2 AND organization_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
    [id, ctx.tenantId, ctx.orgId]);
  if (!rows[0]) throw new ApiError(404, 'WEBSITE_NOT_FOUND', 'Website not found.');
  return rows[0];
}

async function getDeployment(c, ctx, id, lock = false) {
  const { rows } = await c.query(
    `SELECT * FROM publishing_deployments WHERE id=$1 AND tenant_id=$2 AND organization_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
    [id, ctx.tenantId, ctx.orgId]);
  if (!rows[0]) throw new ApiError(404, 'DEPLOYMENT_NOT_FOUND', 'Deployment not found.');
  return rows[0];
}

// Atomically switches the website's active release. Caller must run inside a transaction.
// The website row lock serialises concurrent activations; the previous release is kept as history.
async function activateRelease(c, websiteId, releaseId) {
  const { rows } = await c.query('SELECT active_release_id FROM wb_websites WHERE id=$1 FOR UPDATE', [websiteId]);
  const current = rows[0].active_release_id;
  if (current && current !== releaseId) {
    await c.query("UPDATE publishing_releases SET status='superseded' WHERE id=$1", [current]);
  }
  await c.query("UPDATE publishing_releases SET status='active', activated_at=now() WHERE id=$1", [releaseId]);
  await c.query(
    "UPDATE wb_websites SET active_release_id=$2, status='published', updated_at=now() WHERE id=$1",
    [websiteId, releaseId]);
}

module.exports = { depDto, relDto, audit, getWebsite, getDeployment, activateRelease };
