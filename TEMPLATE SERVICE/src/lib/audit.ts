import type { PoolClient } from 'pg';
import type { RequestContext } from '../types';

/** Audit trail row, written in the same transaction as the change it describes. */
export async function audit(
  db: Pick<PoolClient, 'query'>,
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (tenant_id, organization_id, user_id, request_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ctx.tenantId, ctx.organizationId, ctx.userId, ctx.requestId, action, entityType, entityId, JSON.stringify(details)],
  );
}
