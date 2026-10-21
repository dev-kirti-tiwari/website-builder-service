async function get(db, pageId, ws) {
  const { rows } = await db.query(
    'SELECT layout, responsive FROM page_layouts WHERE page_id = $1 AND workspace_id = $2',
    [pageId, ws],
  );
  return rows[0] || { layout: {}, responsive: {} };
}

async function upsert(db, pageId, ws, layout, responsive) {
  await db.query(
    `INSERT INTO page_layouts (page_id, workspace_id, layout, responsive)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     ON CONFLICT (page_id) DO UPDATE
       SET layout = EXCLUDED.layout, responsive = EXCLUDED.responsive, updated_at = NOW()`,
    [pageId, ws, JSON.stringify(layout), JSON.stringify(responsive)],
  );
}

module.exports = { get, upsert };
