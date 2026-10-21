'use strict';

const express = require('express');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const s = require('../schemas/themeRequests');

const ok = (req, data, meta) => ({ success: true, data, ...(meta ? { meta } : {}), requestId: req.id });
const ctxOf = (req) => ({ ...req.auth, requestId: req.id });
const setEtag = (res, theme) => res.set('ETag', `"${theme.version}"`);

function themeRoutes(service) {
  const r = express.Router();

  r.post('/', requireRole('editor'), validate({ body: s.createBody }), async (req, res) => {
    const theme = await service.create(ctxOf(req), req.valid.body);
    setEtag(res, theme);
    res.status(201).location(`/api/v1/themes/${theme.id}`).json(ok(req, theme));
  });

  r.get('/', requireRole('viewer'), validate({ query: s.listQuery }), async (req, res) => {
    const { items, pagination } = await service.list(ctxOf(req), req.valid.query);
    res.json(ok(req, items, { pagination }));
  });

  r.get('/:id', requireRole('viewer'), validate({ params: s.paramsWithId }), async (req, res) => {
    const theme = await service.get(ctxOf(req), req.valid.params.id);
    setEtag(res, theme);
    res.json(ok(req, theme));
  });

  r.patch('/:id', requireRole('editor'), validate({ params: s.paramsWithId, body: s.updateBody }), async (req, res) => {
    const theme = await service.update(ctxOf(req), req.valid.params.id, req.valid.body, req.get('if-match'));
    setEtag(res, theme);
    res.json(ok(req, theme));
  });

  r.post('/:id/validate', requireRole('viewer'), validate({ params: s.paramsWithId }), async (req, res) => {
    res.json(ok(req, await service.validate(ctxOf(req), req.valid.params.id)));
  });

  r.post('/:id/activate', requireRole('admin'),
    validate({ params: s.paramsWithId, body: s.versionOnlyBody }), async (req, res) => {
      const theme = await service.activate(ctxOf(req), req.valid.params.id, req.valid.body, req.get('if-match'));
      setEtag(res, theme);
      res.json(ok(req, theme));
    });

  r.post('/:id/duplicate', requireRole('editor'),
    validate({ params: s.paramsWithId, body: s.duplicateBody }), async (req, res) => {
      const theme = await service.duplicate(ctxOf(req), req.valid.params.id, req.valid.body);
      setEtag(res, theme);
      res.status(201).location(`/api/v1/themes/${theme.id}`).json(ok(req, theme));
    });

  r.delete('/:id', requireRole('admin'), validate({ params: s.paramsWithId }), async (req, res) => {
    const theme = await service.archive(ctxOf(req), req.valid.params.id, req.get('if-match'));
    setEtag(res, theme);
    res.json(ok(req, theme));
  });

  return r;
}

module.exports = { themeRoutes };
