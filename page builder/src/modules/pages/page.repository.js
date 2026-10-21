const COLS = 'id, workspace_id, name, slug, status, revision, created_by, updated_by, created_at, updated_at';

const map = (r) => r && ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  slug: r.slug,
  status: r.status,
  revision: r.revision,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SORTS = { created_at: 'created_at', updated_at: 'updated_at', name: 'name' };
const META_COLUMNS = { name: 'name', slug: 'slug', status: 'status' };

async function insert(db, ws, { name, slug }, actor) {
  const { rows } = await db.query(
    `INSERT INTO pages (workspace_id, name, slug, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING ${COLS}`,
    [ws, name, slug, actor],
  );
  return map(rows[0]);
}

async function findById(db, id, ws, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM pages WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, ws],
  );
  return map(rows[0]);
}

async function list(db, ws, { q, status, sort, order, limit, offset }) {
  const vals = [ws];
  let where = 'workspace_id = $1 AND deleted_at IS NULL';
  if (status) { vals.push(status); where += ` AND status = $${vals.length}`; }
  if (q) { vals.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where += ` AND (name ILIKE $${vals.length} OR slug ILIKE $${vals.length})`; }
  vals.push(limit, offset);
  const { rows } = await db.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS total FROM pages WHERE ${where}
     ORDER BY ${SORTS[sort]} ${order === 'asc' ? 'ASC' : 'DESC'}, id DESC
     LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals,
  );
  return { items: rows.map(map), total: rows.length ? Number(rows[0].total) : 0 };
}

async function updateMeta(db, id, ws, fields, actor) {
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(META_COLUMNS)) {
    if (fields[key] !== undefined) { vals.push(fields[key]); sets.push(`${col} = $${vals.length}`); }
  }
  vals.push(actor, id, ws);
  const n = vals.length;
  const { rows } = await db.query(
    `UPDATE pages SET ${sets.join(', ')}, updated_at = NOW(), updated_by = $${n - 2}
     WHERE id = $${n - 1} AND workspace_id = $${n} AND deleted_at IS NULL RETURNING ${COLS}`,
    vals,
  );
  return map(rows[0]);
}

async function softDelete(db, id, ws, actor) {
  const { rowCount } = await db.query(
    `UPDATE pages SET deleted_at = NOW(), updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [id, ws, actor],
  );
  return rowCount > 0;
}

async function bumpRevision(db, id, ws, actor) {
  const { rows } = await db.query(
    `UPDATE pages SET revision = revision + 1, updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND workspace_id = $2 RETURNING revision`,
    [id, ws, actor],
  );
  return rows[0].revision;
}

async function slugExists(db, ws, slug) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM pages WHERE workspace_id = $1 AND slug = $2 AND deleted_at IS NULL',
    [ws, slug],
  );
  return rowCount > 0;
}

module.exports = { insert, findById, list, updateMeta, softDelete, bumpRevision, slugExists };
