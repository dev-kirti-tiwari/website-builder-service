import { notFound } from '../../shared/errors';
import type { Db, Scope } from '../../shared/types';

const COLS = `id, form_id, name, label, type, required, options, validation, position,
  created_by, updated_by, created_at, updated_at`;

export interface Field {
  id: string;
  formId: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  validation: Record<string, number>;
  position: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toField = (r: any): Field => ({
  id: r.id,
  formId: r.form_id,
  name: r.name,
  label: r.label,
  type: r.type,
  required: r.required,
  options: r.options,
  validation: r.validation,
  position: r.position,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface FieldInput {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[] | null;
  validation?: Record<string, number>;
  position?: number;
}

export async function insertField(db: Db, scope: Scope, userId: string, formId: string, f: FieldInput): Promise<Field> {
  const { rows } = await db.query(
    `INSERT INTO form_fields
       (tenant_id, organization_id, form_id, name, label, type, required, options, validation, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
       COALESCE($10::int, (SELECT COALESCE(MAX(position), -1) + 1 FROM form_fields WHERE form_id = $3)), $11)
     RETURNING ${COLS}`,
    [
      scope.tenantId, scope.organizationId, formId, f.name, f.label, f.type, f.required,
      f.options ? JSON.stringify(f.options) : null,
      JSON.stringify(f.validation ?? {}),
      f.position ?? null,
      userId,
    ],
  );
  return toField(rows[0]);
}

export async function listFields(db: Db, scope: Scope, formId: string): Promise<Field[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM form_fields
      WHERE form_id = $1 AND tenant_id = $2 AND organization_id = $3
      ORDER BY position, id`,
    [formId, scope.tenantId, scope.organizationId],
  );
  return rows.map(toField);
}

export async function findField(db: Db, scope: Scope, formId: string, fieldId: string): Promise<Field> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM form_fields
      WHERE id = $1 AND form_id = $2 AND tenant_id = $3 AND organization_id = $4`,
    [fieldId, formId, scope.tenantId, scope.organizationId],
  );
  if (!rows[0]) throw notFound('Field');
  return toField(rows[0]);
}

export async function updateField(
  db: Db,
  scope: Scope,
  userId: string,
  formId: string,
  fieldId: string,
  f: Omit<FieldInput, 'name'>,
): Promise<Field> {
  const { rows } = await db.query(
    `UPDATE form_fields
        SET label = $1, type = $2, required = $3, options = $4, validation = $5, position = $6,
            updated_by = $7, updated_at = NOW()
      WHERE id = $8 AND form_id = $9 AND tenant_id = $10 AND organization_id = $11
      RETURNING ${COLS}`,
    [
      f.label, f.type, f.required,
      f.options ? JSON.stringify(f.options) : null,
      JSON.stringify(f.validation ?? {}),
      f.position,
      userId, fieldId, formId, scope.tenantId, scope.organizationId,
    ],
  );
  if (!rows[0]) throw notFound('Field');
  return toField(rows[0]);
}
