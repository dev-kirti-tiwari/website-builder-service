import type { Actor, Db, Scope } from '../../shared/types';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string;
  details?: Record<string, unknown>;
}

/** Records an audit event. `actor` null means an anonymous visitor. */
export async function recordAudit(db: Db, scope: Scope, actor: Actor | null, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_events
       (tenant_id, organization_id, actor_type, actor_id, action, entity_type, entity_id, request_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      scope.tenantId,
      scope.organizationId,
      actor ? 'USER' : 'ANONYMOUS_VISITOR',
      actor ? actor.userId : null,
      input.action,
      input.entityType,
      input.entityId,
      input.requestId,
      JSON.stringify(input.details ?? {}),
    ],
  );
}
