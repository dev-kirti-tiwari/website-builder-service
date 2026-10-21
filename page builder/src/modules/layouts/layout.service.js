const layoutRepo = require('./layout.repository');
const { layoutSchema, responsiveSchema } = require('./layout.schema');
const { mergeObject, mergeResponsive } = require('../../utils/merge');
const { AppError } = require('../../utils/errors');
const audit = require('../../integrations/auditClient');
const revisions = require('../revisions/revision.service');

const details = (location, error) =>
  error.issues.map((i) => ({ location, path: i.path.join('.'), message: i.message }));

// Merges a layout patch into the stored layout, validates, and persists. Runs inside a transaction.
async function applyLayoutPatch(db, ctx, pageId, patch) {
  const current = await layoutRepo.get(db, pageId, ctx.workspaceId);
  const layout = patch.layout ? mergeObject(current.layout, patch.layout) : current.layout;
  const responsive = patch.responsive ? mergeResponsive(current.responsive, patch.responsive) : current.responsive;

  const l = layoutSchema.safeParse(layout);
  const r = responsiveSchema.safeParse(responsive);
  const errs = [...(l.success ? [] : details('layout', l.error)), ...(r.success ? [] : details('responsive', r.error))];
  if (errs.length) throw new AppError(422, 'VALIDATION_ERROR', 'Layout configuration is invalid.', errs);

  await layoutRepo.upsert(db, pageId, ctx.workspaceId, l.data, r.data);
  return { layout: l.data, responsive: r.data };
}

async function update(ctx, pageId, body) {
  return revisions.mutate(ctx, pageId, body.expectedRevision, async (db) => {
    const result = await applyLayoutPatch(db, ctx, pageId, body);
    await audit(db, ctx, 'PAGE_UPDATED', `page:${pageId}`, { layout: true });
    return result;
  });
}

module.exports = { applyLayoutPatch, update };
