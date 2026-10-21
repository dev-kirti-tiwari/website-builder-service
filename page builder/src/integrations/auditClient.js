// Local audit trail (page_audit_logs). Swap this module to forward to a central audit service.
module.exports = (db, ctx, action, resource, metadata = {}) =>
  db.query(
    `INSERT INTO page_audit_logs (workspace_id, actor_id, action, resource, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [ctx.workspaceId, ctx.actorId, action, resource, ctx.requestId, JSON.stringify(metadata)],
  );
