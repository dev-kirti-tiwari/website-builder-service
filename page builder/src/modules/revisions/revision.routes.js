const express = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const authorize = require('../../middleware/authorization');
const { idSchema, expectedRevision } = require('../../validators/common');
const service = require('./revision.service');
const { ctxOf, send } = require('../../utils/http');

const router = express.Router({ mergeParams: true });

const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', authorize('read'),
  validate({ params: z.object({ id: idSchema }), query: paging }),
  async (req, res) => {
    const { page, limit } = req.valid.query;
    const r = await service.list(ctxOf(req), req.valid.params.id, { limit, offset: (page - 1) * limit });
    send(req, res, r.items, { meta: { pagination: { page, limit, total: r.total }, currentRevision: r.currentRevision } });
  });

router.post('/:revision/restore', authorize('edit'),
  validate({
    params: z.object({ id: idSchema, revision: z.coerce.number().int().min(1).max(2147483647) }),
    body: z.object({ expectedRevision }).strict(),
  }),
  async (req, res) => {
    const { id, revision } = req.valid.params;
    const { data, revision: current } = await service.restore(ctxOf(req), id, revision, req.valid.body.expectedRevision);
    send(req, res, { id, revision: current, ...data });
  });

module.exports = router;
