const express = require('express');
const validate = require('../../middleware/validate');
const authorize = require('../../middleware/authorization');
const { idSchema } = require('../../validators/common');
const { z } = require('zod');
const schema = require('./layout.schema');
const service = require('./layout.service');
const { ctxOf, send } = require('../../utils/http');

const router = express.Router({ mergeParams: true });

router.patch('/', authorize('edit'),
  validate({ params: z.object({ id: idSchema }), body: schema.patchBody }),
  async (req, res) => {
    const { data, revision } = await service.update(ctxOf(req), req.valid.params.id, req.valid.body);
    send(req, res, data, { meta: { revision } });
  });

module.exports = router;
