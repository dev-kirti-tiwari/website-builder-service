'use strict';
const { pool } = require('../../config/database');

const COLS = `id, workspace_id, page_id, section_id, section_type, schema_version, content, revision,
  created_by, updated_by, created_at, updated_at, deleted_at`;

const q = (client) => client || pool;

const toContent = (r) => r && ({
  id: r.id,
  workspaceId: r.workspace_id,
  pageId: r.page_id,
  sectionId: r.section_id,
  sectionType: r.section_type,
  schemaVersion: r.schema_version,
  revision: r.revision,
  content: r.content,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRevision = (r) => ({
  id: r.id,
  contentId: r.section_content_id,
  sectionId: r.section_id,
  revision: r.revision_number,
  schemaVersion: r.schema_version,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

async function findBySection(workspaceId, sectionId, { client, forUpdate = false } = {}) {
  const { rows } = await q(client).query(
    `SELECT ${COLS} FROM section_contents
      WHERE section_id = $1 AND workspace_id = $2 AND deleted_at IS NULL ${forUpdate ? 'FOR UPDATE' : ''}`,
    [sectionId, workspaceId]);
  return toContent(rows[0]);
}

async function findByPage(workspaceId, pageId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM section_contents
      WHERE page_id = $1 AND workspace_id = $2 AND deleted_at IS NULL ORDER BY id`,
    [pageId, workspaceId]);
  return rows.map(toContent);
}

async function insert(client, { workspaceId, pageId, sectionId, sectionType, schemaVersion, content, actorId }) {
  const { rows } = await client.query(
    `INSERT INTO section_contents
       (workspace_id, page_id, section_id, section_type, schema_version, content, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7) RETURNING ${COLS}`,
    [workspaceId, pageId, sectionId, sectionType, schemaVersion, JSON.stringify(content), actorId]);
  return toContent(rows[0]);
}

/** Bumps revision and stores new content. Caller holds the row lock and has verified expectedRevision. */
async function update(client, { id, workspaceId, schemaVersion, content, actorId }) {
  const { rows } = await client.query(
    `UPDATE section_contents
        SET content = $3::jsonb, schema_version = $4, revision = revision + 1, updated_by = $5, updated_at = NOW()
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [id, workspaceId, JSON.stringify(content), schemaVersion, actorId]);
  return toContent(rows[0]);
}

async function softDelete(client, { id, workspaceId, actorId }) {
  const { rowCount } = await client.query(
    `UPDATE section_contents SET deleted_at = NOW(), updated_at = NOW(), updated_by = $3
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [id, workspaceId, actorId]);
  return rowCount === 1;
}

async function insertRevision(client, row) {
  await client.query(
    `INSERT INTO content_revisions
       (workspace_id, section_content_id, page_id, section_id, revision_number, schema_version, snapshot, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [row.workspaceId, row.id, row.pageId, row.sectionId, row.revision, row.schemaVersion, JSON.stringify(row.content), row.updatedBy]);
}

async function listRevisions(workspaceId, contentId, { limit, offset }) {
  const [list, total] = await Promise.all([
    pool.query(
      `SELECT * FROM content_revisions WHERE workspace_id = $1 AND section_content_id = $2
        ORDER BY revision_number DESC LIMIT $3 OFFSET $4`, [workspaceId, contentId, limit, offset]),
    pool.query(
      'SELECT COUNT(*)::int AS n FROM content_revisions WHERE workspace_id = $1 AND section_content_id = $2',
      [workspaceId, contentId]),
  ]);
  return { items: list.rows.map(toRevision), total: total.rows[0].n };
}

async function findRevision(client, workspaceId, contentId, revisionNumber) {
  const { rows } = await client.query(
    `SELECT * FROM content_revisions
      WHERE workspace_id = $1 AND section_content_id = $2 AND revision_number = $3`,
    [workspaceId, contentId, revisionNumber]);
  return rows[0] && { ...toRevision(rows[0]), snapshot: rows[0].snapshot };
}

module.exports = { findBySection, findByPage, insert, update, softDelete, insertRevision, listRevisions, findRevision };
