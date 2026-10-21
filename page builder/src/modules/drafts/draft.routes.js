const express = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const authorize = require('../../middleware/authorization');
const { idSchema, revisionNumber } = require('../../validators/common');
const { patchFields } = require('../sections/section.schema');
const service = require('./draft.service');
const { ctxOf, send } = require('../../utils/http');

const router = express.Router({ mergeParams: true });
const params = z.object({ id: idSchema });

const sectionPatch = z.object({
  id: idSchema,
  position: z.number().int().min(1).max(10000).optional(),
  ...patchFields,
}).strict();

const autosaveBody = z.object({
  expectedRevision: revisionNumber,
  changes: z.object({
    layout: z.object({
      layout: z.record(z.string(), z.unknown()).optional(),
      responsive: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()).optional(),
    }).strict().optional(),
    sections: z.array(sectionPatch).max(500).optional(),
  }).strict().refine((c) => c.layout || (c.sections && c.sections.length), 'Provide at least one change'),
}).strict();

router.get('/', authorize('read'), validate({ params }), async (req, res) => {
  send(req, res, await service.getDraft(ctxOf(req), req.valid.params.id));
});

router.patch('/', authorize('edit'), validate({ params, body: autosaveBody }), async (req, res) => {
  const { id } = req.valid.params;
  const { data, revision } = await service.autosave(ctxOf(req), id, req.valid.body);
  send(req, res, { id, revision, sections: data });
});

module.exports = router;
