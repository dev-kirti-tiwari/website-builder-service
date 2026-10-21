'use strict';

// All SQL is parameterized and every query is scoped by workspace_id.

const COLUMNS = `id, workspace_id, name, slug, description, status, version, schema_version,
  config, created_by, updated_by, created_at, updated_at, deleted_at`;
const SUMMARY_COLUMNS = COLUMNS.replace('config,', '');

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function insert(db, t) {
  const { rows } = await db.query(
    `INSERT INTO themes (workspace_id, name, slug, description, status, version, schema_version, config, created_by)
     VALUES ($1, $2, $3, $4, 'DRAFT', 1, $5, $6::jsonb, $7)
     RETURNING ${COLUMNS}`,
    [t.workspaceId, t.name, t.slug, t.description ?? null, t.schemaVersion, JSON.stringify(t.config), t.createdBy],
  );
  return rows[0];
}

async function findById(db, workspaceId, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM themes WHERE id = $1 AND workspace_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id, workspaceId],
  );
  return rows[0] || null;
}

async function list(db, workspaceId, { status, search, limit, offset }) {
  const where = ['workspace_id = $1'];
  const params = [workspaceId];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  } else {
    where.push(`status <> 'ARCHIVED'`);
  }
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    where.push(`(name ILIKE $${params.length} OR slug ILIKE $${params.length})`);
  }
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM themes WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { rows, total };
}

/** Slugs (incl. archived ones, which stay reserved) that equal `base` or start with `base-`. */
async function findSlugsLike(db, workspaceId, base) {
  const { rows } = await db.query(
    `SELECT slug FROM themes WHERE workspace_id = $1 AND (slug = $2 OR slug LIKE $3 ESCAPE '\\')`,
    [workspaceId, base, `${escapeLike(base)}-%`],
  );
  return new Set(rows.map((r) => r.slug));
}

async function slugExists(db, workspaceId, slug) {
  const { rowCount } = await db.query('SELECT 1 FROM themes WHERE workspace_id = $1 AND slug = $2', [workspaceId, slug]);
  return rowCount > 0;
}

/**
 * Optimistic update: only succeeds while the row still has `expectedVersion`.
 * version and updated_at change atomically in the same statement.
 */
async function updateWithVersion(db, workspaceId, id, expectedVersion, fields) {
  const sets = [];
  const params = [id, workspaceId, expectedVersion];
  const add = (column, value, cast = '') => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  if (fields.name !== undefined) add('name', fields.name);
  if (fields.description !== undefined) add('description', fields.description);
  if (fields.status !== undefined) add('status', fields.status);
  if (fields.config !== undefined) {
    add('config', JSON.stringify(fields.config), '::jsonb');
    add('schema_version', fields.schemaVersion);
  }
  if (fields.archive) sets.push('deleted_at = NOW()');
  add('updated_by', fields.updatedBy);
  const { rows } = await db.query(
    `UPDATE themes SET ${sets.join(', ')}, version = version + 1, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND version = $3
     RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] || null;
}

async function ping(db) {
  await db.query('SELECT 1');
}

module.exports = { insert, findById, list, findSlugsLike, slugExists, updateWithVersion, ping };
