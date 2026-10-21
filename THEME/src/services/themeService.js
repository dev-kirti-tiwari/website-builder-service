'use strict';

const { AppError, notFound } = require('../errors');
const { withTransaction } = require('../db');
const repo = require('../repositories/themeRepository');
const { validateThemeConfig } = require('./themeValidator');
const { SCHEMA_VERSION } = require('../schemas/themeConfig');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** RFC 7386 JSON merge patch: objects merge, arrays/scalars replace, null deletes. */
function mergePatch(target, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(target) ? { ...target } : {};
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (patch[key] === null) delete out[key];
    else out[key] = mergePatch(out[key], patch[key]);
  }
  return out;
}

function slugify(text) {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
    .replace(/-+$/g, '');
  return s || 'theme';
}

function toApi(row, { includeConfig = true } = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    version: row.version,
    schemaVersion: row.schema_version,
    ...(includeConfig ? { config: row.config } : {}),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.deleted_at,
  };
}

/** expectedVersion may come from the body or an If-Match header ("3", W/"3"). */
function resolveExpectedVersion(bodyVersion, ifMatch, { required }) {
  let headerVersion;
  if (ifMatch !== undefined) {
    const m = /^(?:W\/)?"?(\d{1,10})"?$/.exec(String(ifMatch).trim());
    if (!m) throw new AppError(400, 'VALIDATION_ERROR', 'If-Match must contain a theme version number');
    headerVersion = Number(m[1]);
  }
  if (bodyVersion !== undefined && headerVersion !== undefined && bodyVersion !== headerVersion) {
    throw new AppError(400, 'VALIDATION_ERROR', 'expectedVersion and If-Match disagree');
  }
  const v = bodyVersion ?? headerVersion;
  if (v === undefined && required) {
    throw new AppError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion (body) or If-Match header is required');
  }
  return v;
}

function createThemeService({ pool, config, audit }) {
  const normalizeConfig = (cfg) => ({ ...cfg, schemaVersion: SCHEMA_VERSION });

  function assertSize(cfg) {
    const bytes = Buffer.byteLength(JSON.stringify(cfg));
    if (bytes > config.THEME_MAX_CONFIG_BYTES) {
      throw new AppError(413, 'CONFIG_TOO_LARGE', `Theme configuration exceeds ${config.THEME_MAX_CONFIG_BYTES} bytes`);
    }
  }

  function assertDraftValid(cfg) {
    assertSize(cfg);
    const { errors } = validateThemeConfig(cfg);
    if (errors.length) throw new AppError(422, 'THEME_CONFIG_INVALID', 'Theme configuration is invalid', errors);
  }

  async function generateSlug(db, workspaceId, name, suffix = '') {
    const base = slugify(name) + suffix;
    const taken = await repo.findSlugsLike(db, workspaceId, base);
    if (!taken.has(base)) return base;
    for (let i = 2; i < 10000; i += 1) {
      if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    }
    throw new AppError(409, 'THEME_SLUG_CONFLICT', 'Could not generate a unique slug');
  }

  const slugConflict = () =>
    new AppError(409, 'THEME_SLUG_CONFLICT', 'A theme with this slug already exists in the workspace (slugs stay reserved after archiving)');

  /** Load the row under lock and apply the optimistic version check. */
  async function lockAndCheck(db, ctx, id, expectedVersion) {
    const cur = await repo.findById(db, ctx.workspaceId, id, { forUpdate: true });
    if (!cur) throw notFound();
    if (expectedVersion !== undefined && cur.version !== expectedVersion) {
      throw new AppError(409, 'THEME_VERSION_CONFLICT', 'Theme was modified by someone else; reload and retry', {
        expectedVersion,
        currentVersion: cur.version,
      });
    }
    return cur;
  }

  async function writeOrConflict(db, ctx, cur, fields) {
    const row = await repo.updateWithVersion(db, ctx.workspaceId, cur.id, cur.version, fields);
    if (!row) throw new AppError(409, 'THEME_VERSION_CONFLICT', 'Theme was modified by someone else; reload and retry');
    return row;
  }

  return {
    async create(ctx, body) {
      const cfg = normalizeConfig(body.config ?? {});
      assertDraftValid(cfg);
      const row = await withTransaction(pool, async (db) => {
        let slug;
        if (body.slug) {
          if (await repo.slugExists(db, ctx.workspaceId, body.slug)) throw slugConflict();
          slug = body.slug;
        } else {
          slug = await generateSlug(db, ctx.workspaceId, body.name);
        }
        return repo.insert(db, {
          workspaceId: ctx.workspaceId, name: body.name, slug, description: body.description,
          schemaVersion: SCHEMA_VERSION, config: cfg, createdBy: ctx.userId,
        });
      });
      audit.emit('THEME_CREATED', ctx, row);
      return toApi(row);
    },

    async list(ctx, q) {
      const { rows, total } = await repo.list(pool, ctx.workspaceId, {
        status: q.status, search: q.search, limit: q.pageSize, offset: (q.page - 1) * q.pageSize,
      });
      return {
        items: rows.map((r) => toApi(r, { includeConfig: false })),
        pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
      };
    },

    async get(ctx, id) {
      const row = await repo.findById(pool, ctx.workspaceId, id);
      if (!row) throw notFound();
      return toApi(row);
    },

    async update(ctx, id, body, ifMatch) {
      const expected = resolveExpectedVersion(body.expectedVersion, ifMatch, { required: true });
      const row = await withTransaction(pool, async (db) => {
        const cur = await lockAndCheck(db, ctx, id, expected);
        if (cur.status !== 'DRAFT') {
          throw new AppError(409, 'THEME_NOT_EDITABLE',
            `Only DRAFT themes can be edited (this theme is ${cur.status}). Duplicate it to create an editable draft.`);
        }
        const fields = { updatedBy: ctx.userId };
        if (body.name !== undefined) fields.name = body.name;
        if (body.description !== undefined) fields.description = body.description;
        if (body.config !== undefined) {
          const merged = normalizeConfig(mergePatch(cur.config, body.config));
          assertDraftValid(merged);
          fields.config = merged;
          fields.schemaVersion = SCHEMA_VERSION;
        }
        return writeOrConflict(db, ctx, cur, fields);
      });
      audit.emit('THEME_UPDATED', ctx, row);
      return toApi(row);
    },

    /** Always 200: reports every problem found. `valid` means ready for activation. */
    async validate(ctx, id) {
      const row = await repo.findById(pool, ctx.workspaceId, id);
      if (!row) throw notFound();
      const { errors, warnings } = validateThemeConfig(row.config, { activation: true });
      return { themeId: row.id, version: row.version, valid: errors.length === 0, errors, warnings };
    },

    async activate(ctx, id, body, ifMatch) {
      const expected = resolveExpectedVersion(body.expectedVersion, ifMatch, { required: false });
      const row = await withTransaction(pool, async (db) => {
        const cur = await lockAndCheck(db, ctx, id, expected);
        if (cur.status !== 'DRAFT') {
          throw new AppError(409, 'THEME_LIFECYCLE_CONFLICT', `Only DRAFT themes can be activated (this theme is ${cur.status})`);
        }
        assertSize(cur.config);
        const { errors } = validateThemeConfig(cur.config, { activation: true });
        if (errors.length) {
          throw new AppError(422, 'THEME_ACTIVATION_INVALID', 'Theme is not valid for activation', errors);
        }
        return writeOrConflict(db, ctx, cur, { status: 'ACTIVE', updatedBy: ctx.userId });
      });
      audit.emit('THEME_ACTIVATED', ctx, row);
      return toApi(row);
    },

    /** New DRAFT from visual configuration only; nothing else is carried over. */
    async duplicate(ctx, id, body) {
      const { row, source } = await withTransaction(pool, async (db) => {
        const src = await repo.findById(db, ctx.workspaceId, id);
        if (!src) throw notFound();
        const name = (body.name ?? `${src.name} (Copy)`).slice(0, 150);
        const slug = await generateSlug(db, ctx.workspaceId, name);
        const created = await repo.insert(db, {
          workspaceId: ctx.workspaceId, name, slug, description: src.description,
          schemaVersion: src.schema_version, config: src.config, createdBy: ctx.userId,
        });
        return { row: created, source: src };
      });
      audit.emit('THEME_DUPLICATED', ctx, row, { sourceThemeId: source.id });
      return toApi(row);
    },

    async archive(ctx, id, ifMatch) {
      const expected = resolveExpectedVersion(undefined, ifMatch, { required: false });
      const row = await withTransaction(pool, async (db) => {
        const cur = await lockAndCheck(db, ctx, id, expected);
        if (cur.status === 'ARCHIVED') {
          throw new AppError(409, 'THEME_LIFECYCLE_CONFLICT', 'Theme is already archived');
        }
        return writeOrConflict(db, ctx, cur, { status: 'ARCHIVED', archive: true, updatedBy: ctx.userId });
      });
      audit.emit('THEME_ARCHIVED', ctx, row);
      return toApi(row);
    },
  };
}

module.exports = { createThemeService, mergePatch, slugify };
