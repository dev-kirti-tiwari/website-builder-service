const service = require('./page.service');
const { ctxOf, send } = require('../../utils/http');

exports.create = async (req, res) =>
  send(req, res, await service.create(ctxOf(req), req.valid.body), { status: 201 });

exports.list = async (req, res) => {
  const { items, total } = await service.list(ctxOf(req), req.valid.query);
  const { page, limit } = req.valid.query;
  send(req, res, items, { meta: { pagination: { page, limit, total } } });
};

exports.get = async (req, res) =>
  send(req, res, await service.get(ctxOf(req), req.valid.params.id, req.valid.query.include));

exports.update = async (req, res) =>
  send(req, res, await service.update(ctxOf(req), req.valid.params.id, req.valid.body));

exports.duplicate = async (req, res) =>
  send(req, res, await service.duplicate(ctxOf(req), req.valid.params.id), { status: 201 });

exports.remove = async (req, res) =>
  send(req, res, await service.remove(ctxOf(req), req.valid.params.id));
