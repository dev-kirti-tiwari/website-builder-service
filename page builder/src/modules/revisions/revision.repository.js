const map = (r) => r && ({
  id: r.id,
  revision: r.revision_number,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

async function insert(db, ws, pageId, revisionNumber, snapshot, actor) {
  await db.query(
    `INSERT INTO page_revisions (page_id, workspace_id, revision_number, snapshot, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [pageId, ws, revisionNumber, JSON.stringify(snapshot), actor],
  );
}

async function list(db, pageId, ws, { limit, offset }) {
  const { rows } = await db.query(
    `SELECT id, revision_number, created_by, created_at, COUNT(*) OVER() AS total
     FROM page_revisions WHERE page_id = $1 AND workspace_id = $2
     ORDER BY revision_number DESC LIMIT $3 OFFSET $4`,
    [pageId, ws, limit, offset],
  );
  return { items: rows.map(map), total: rows.length ? Number(rows[0].total) : 0 };
}

async function findSnapshot(db, pageId, ws, revisionNumber) {
  const { rows } = await db.query(
    'SELECT snapshot FROM page_revisions WHERE page_id = $1 AND workspace_id = $2 AND revision_number = $3',
    [pageId, ws, revisionNumber],
  );
  return rows[0] ? rows[0].snapshot : null;
}

module.exports = { insert, list, findSnapshot };
