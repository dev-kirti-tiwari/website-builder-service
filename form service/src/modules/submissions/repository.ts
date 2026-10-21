import { notFound } from '../../shared/errors';
import type { Db, Scope } from '../../shared/types';

const COLS = `id, form_id, schema_version_id, data, status, actor_type, user_id, request_id,
  metadata, created_at, updated_at, updated_by`;

export interface Submission {
  id: string;
  formId: string;
  schemaVersionId: string;
  data: Record<string, unknown>;
  status: string;
  actorType: string;
  userId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toSubmission = (r: any): Submission => ({
  id: r.id,
  formId: r.form_id,
  schemaVersionId: r.schema_version_id,
  data: r.data,
  status: r.status,
  actorType: r.actor_type,
  userId: r.user_id,
  requestId: r.request_id,
  metadata: r.metadata,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

export async function listSubmissions(
  db: Db,
  scope: Scope,
  formId: string,
  opts: { page: number; limit: number; status?: string },
): Promise<{ items: Submission[]; total: number }> {
  const where = `tenant_id = $1 AND organization_id = $2 AND form_id = $3 AND ($4::text IS NULL OR status = $4)`;
  const params = [scope.tenantId, scope.organizationId, formId, opts.status ?? null];
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM form_submissions WHERE ${where}`, params);
  const { rows } = await db.query(
    `SELECT ${COLS} FROM form_submissions WHERE ${where} ORDER BY id DESC LIMIT $5 OFFSET $6`,
    [...params, opts.limit, (opts.page - 1) * opts.limit],
  );
  return { items: rows.map(toSubmission), total: count.rows[0].total };
}

export async function getSubmission(db: Db, scope: Scope, formId: string, id: string): Promise<Submission> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM form_submissions
      WHERE id = $1 AND form_id = $2 AND tenant_id = $3 AND organization_id = $4`,
    [id, formId, scope.tenantId, scope.organizationId],
  );
  if (!rows[0]) throw notFound('Submission');
  return toSubmission(rows[0]);
}

export async function updateSubmission(
  db: Db,
  scope: Scope,
  userId: string,
  formId: string,
  id: string,
  patch: { status?: string; metadata?: Record<string, unknown> },
): Promise<Submission> {
  const { rows } = await db.query(
    `UPDATE form_submissions
        SET status = COALESCE($1, status),
            metadata = COALESCE($2::jsonb, metadata),
            updated_by = $3,
            updated_at = NOW()
      WHERE id = $4 AND form_id = $5 AND tenant_id = $6 AND organization_id = $7
      RETURNING ${COLS}`,
    [
      patch.status ?? null,
      patch.metadata ? JSON.stringify(patch.metadata) : null,
      userId, id, formId, scope.tenantId, scope.organizationId,
    ],
  );
  if (!rows[0]) throw notFound('Submission');
  return toSubmission(rows[0]);
}
