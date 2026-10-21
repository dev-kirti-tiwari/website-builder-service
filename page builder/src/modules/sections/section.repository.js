const COLS = 'id, page_id, section_type, position, variant, visible, configuration, responsive, content_ref, created_at, updated_at';

const map = (r) => r && ({
  id: r.id,
  pageId: r.page_id,
  type: r.section_type,
  position: r.position,
  variant: r.variant,
  visible: r.visible,
  configuration: r.configuration,
  responsive: r.responsive,
  contentRef: r.content_ref,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const UPDATE_COLUMNS = {
  variant: 'variant',
  visible: 'visible',
  contentRef: 'content_ref',
  configuration: 'configuration::jsonb',
  responsive: 'responsive::jsonb',
};

async function listByPage(db, pageId, ws) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM page_sections WHERE page_id = $1 AND workspace_id = $2 ORDER BY position, id`,
    [pageId, ws],
  );
  return rows.map(map);
}

async function find(db, id, pageId, ws) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM page_sections WHERE id = $1 AND page_id = $2 AND workspace_id = $3`,
    [id, pageId, ws],
  );
  return map(rows[0]);
}

async function count(db, pageId, ws) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM page_sections WHERE page_id = $1 AND workspace_id = $2',
    [pageId, ws],
  );
  return rows[0].n;
}

// `id` is only passed when restoring a snapshot so section IDs stay stable.
async function insert(db, ws, pageId, s) {
  const cols = ['page_id', 'workspace_id', 'section_type', 'position', 'variant', 'visible', 'configuration', 'responsive', 'content_ref'];
  const vals = [pageId, ws, s.type, s.position, s.variant, s.visible ?? true,
    JSON.stringify(s.configuration || {}), JSON.stringify(s.responsive || {}), s.contentRef ?? null];
  if (s.id) { cols.push('id'); vals.push(s.id); }
  const params = vals.map((_, i) => `$${i + 1}`);
  params[6] += '::jsonb';
  params[7] += '::jsonb';
  const { rows } = await db.query(
    `INSERT INTO page_sections (${cols.join(', ')}) VALUES (${params.join(', ')}) RETURNING ${COLS}`,
    vals,
  );
  return map(rows[0]);
}

async function update(db, id, pageId, ws, fields) {
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(UPDATE_COLUMNS)) {
    if (fields[key] === undefined) continue;
    const isJson = col.endsWith('::jsonb');
    vals.push(isJson ? JSON.stringify(fields[key]) : fields[key]);
    sets.push(`${isJson ? col.replace('::jsonb', '') : col} = $${vals.length}${isJson ? '::jsonb' : ''}`);
  }
  if (!sets.length) return find(db, id, pageId, ws);
  vals.push(id, pageId, ws);
  const n = vals.length;
  const { rows } = await db.query(
    `UPDATE page_sections SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${n - 2} AND page_id = $${n - 1} AND workspace_id = $${n} RETURNING ${COLS}`,
    vals,
  );
  return map(rows[0]);
}

async function remove(db, id, pageId, ws) {
  const { rowCount } = await db.query(
    'DELETE FROM page_sections WHERE id = $1 AND page_id = $2 AND workspace_id = $3',
    [id, pageId, ws],
  );
  return rowCount > 0;
}

async function removeAll(db, pageId, ws) {
  await db.query('DELETE FROM page_sections WHERE page_id = $1 AND workspace_id = $2', [pageId, ws]);
}

async function shiftFrom(db, pageId, ws, fromPosition, by) {
  await db.query(
    'UPDATE page_sections SET position = position + $3 WHERE page_id = $1 AND workspace_id = $2 AND position >= $4',
    [pageId, ws, by, fromPosition],
  );
}

async function normalize(db, pageId, ws) {
  await db.query(
    `UPDATE page_sections s SET position = r.rn
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id)::int AS rn
           FROM page_sections WHERE page_id = $1 AND workspace_id = $2) r
     WHERE s.id = r.id AND s.position <> r.rn`,
    [pageId, ws],
  );
}

// Writes positions 1..n in the order of `ids` in a single statement.
async function setOrder(db, pageId, ws, ids) {
  await db.query(
    `UPDATE page_sections s SET position = t.pos::int, updated_at = NOW()
     FROM unnest($3::bigint[]) WITH ORDINALITY AS t(id, pos)
     WHERE s.id = t.id AND s.page_id = $1 AND s.workspace_id = $2`,
    [pageId, ws, ids],
  );
}

async function copyAll(db, ws, fromPageId, toPageId) {
  await db.query(
    `INSERT INTO page_sections (page_id, workspace_id, section_type, position, variant, visible, configuration, responsive, content_ref)
     SELECT $3, workspace_id, section_type, position, variant, visible, configuration, responsive, content_ref
     FROM page_sections WHERE page_id = $1 AND workspace_id = $2 ORDER BY position, id`,
    [fromPageId, ws, toPageId],
  );
}

module.exports = { listByPage, find, count, insert, update, remove, removeAll, shiftFrom, normalize, setOrder, copyAll };
