import { AppError, notFound } from '../../shared/errors';
import type { Db, Scope } from '../../shared/types';

const COLS = `id, tenant_id, organization_id, website_id, name, slug, description, status, revision,
  published_version_id, created_by, updated_by, created_at, updated_at`;

export interface Form {
  id: string;
  tenantId: string;
  organizationId: string;
  websiteId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  revision: number;
  publishedVersionId: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toForm = (r: any): Form => ({
  id: r.id,
  tenantId: r.tenant_id,
  organizationId: r.organization_id,
  websiteId: r.website_id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  status: r.status,
  revision: r.revision,
  publishedVersionId: r.published_version_id,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function insertForm(
  db: Db,
  scope: Scope,
  userId: string,
  websiteId: string,
  input: { name: string; slug: string; description?: string | null },
): Promise<Form> {
  const { rows } = await db.query(
    `INSERT INTO forms (tenant_id, organization_id, website_id, name, slug, description, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
     RETURNING ${COLS}`,
    [scope.tenantId, scope.organizationId, websiteId, input.name, input.slug, input.description ?? null, userId],
  );
  return toForm(rows[0]);
}

export async function listForms(
  db: Db,
  scope: Scope,
  websiteId: string,
  page: number,
  limit: number,
): Promise<{ items: Form[]; total: number }> {
  const where = `tenant_id = $1 AND organization_id = $2 AND website_id = $3 AND deleted_at IS NULL`;
  const params = [scope.tenantId, scope.organizationId, websiteId];
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM forms WHERE ${where}`, params);
  const { rows } = await db.query(
    `SELECT ${COLS} FROM forms WHERE ${where} ORDER BY id DESC LIMIT $4 OFFSET $5`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows.map(toForm), total: count.rows[0].total };
}

/** Returns the form only if it is inside the caller's tenant + organization and not deleted. */
export async function findForm(db: Db, scope: Scope, formId: string, lock = false): Promise<Form | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM forms
      WHERE id = $1 AND tenant_id = $2 AND organization_id = $3 AND deleted_at IS NULL
      ${lock ? 'FOR UPDATE' : ''}`,
    [formId, scope.tenantId, scope.organizationId],
  );
  return rows[0] ? toForm(rows[0]) : null;
}

export async function requireForm(db: Db, scope: Scope, formId: string, lock = false): Promise<Form> {
  const form = await findForm(db, scope, formId, lock);
  if (!form) throw notFound('Form');
  return form;
}

export async function updateForm(
  db: Db,
  scope: Scope,
  userId: string,
  formId: string,
  patch: { name?: string; slug?: string; description?: string | null; revision?: number },
): Promise<Form> {
  const { rows } = await db.query(
    `UPDATE forms
        SET name = COALESCE($1, name),
            slug = COALESCE($2, slug),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            updated_by = $5,
            updated_at = NOW(),
            revision = revision + 1
      WHERE id = $6 AND tenant_id = $7 AND organization_id = $8 AND deleted_at IS NULL
        AND ($9::int IS NULL OR revision = $9)
      RETURNING ${COLS}`,
    [
      patch.name ?? null,
      patch.slug ?? null,
      patch.description !== undefined,
      patch.description ?? null,
      userId,
      formId,
      scope.tenantId,
      scope.organizationId,
      patch.revision ?? null,
    ],
  );
  if (rows[0]) return toForm(rows[0]);
  // Distinguish a stale revision from a missing/out-of-scope form.
  await requireForm(db, scope, formId);
  throw new AppError(409, 'REVISION_CONFLICT', 'The form was modified by someone else; reload and retry');
}

export async function softDeleteForm(db: Db, scope: Scope, userId: string, formId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE forms SET deleted_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3 AND organization_id = $4 AND deleted_at IS NULL`,
    [userId, formId, scope.tenantId, scope.organizationId],
  );
  return (rowCount ?? 0) > 0;
}
