'use strict';
const service = require('./content.service');
const { E } = require('../../utils/errors');
const { parseId } = require('../../utils/ids');

const ctxOf = (req) => ({ workspaceId: req.workspaceId, actor: req.actor, requestId: req.id });
const ok = (req, res, data, status = 200) =>
  res.status(status).json({ success: true, data, meta: { requestId: req.id } });

const idParam = (req, name) => {
  const id = parseId(req.params[name]);
  if (!id) throw E.badRequest(`${name} must be a positive integer id`);
  return id;
};

const intQuery = (v, def, min, max, name) => {
  if (v === undefined) return def;
  if (!/^\d+$/.test(String(v))) throw E.badRequest(`${name} must be an integer`);
  const n = Number(v);
  if (n < min || n > max) throw E.badRequest(`${name} must be between ${min} and ${max}`);
  return n;
};

exports.create = async (req, res) => ok(req, res, await service.create(ctxOf(req), idParam(req, 'sectionId'), req.body), 201);
exports.get = async (req, res) => ok(req, res, await service.get(ctxOf(req), idParam(req, 'sectionId')));
exports.replace = async (req, res) => ok(req, res, await service.replace(ctxOf(req), idParam(req, 'sectionId'), req.body));
exports.patch = async (req, res) => ok(req, res, await service.patch(ctxOf(req), idParam(req, 'sectionId'), req.body));

exports.remove = async (req, res) => {
  const sectionId = idParam(req, 'sectionId');
  const expectedRevision = intQuery(req.query.expectedRevision, undefined, 1, 2147483647, 'expectedRevision');
  await service.remove(ctxOf(req), sectionId, expectedRevision);
  ok(req, res, { sectionId, deleted: true });
};

exports.getByPage = async (req, res) => ok(req, res, await service.getByPage(ctxOf(req), idParam(req, 'pageId')));

exports.listRevisions = async (req, res) => {
  const limit = intQuery(req.query.limit, 20, 1, 100, 'limit');
  const offset = intQuery(req.query.offset, 0, 0, 1000000, 'offset');
  ok(req, res, await service.listRevisions(ctxOf(req), idParam(req, 'sectionId'), { limit, offset }));
};

exports.restore = async (req, res) => {
  const raw = req.params.revision;
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647) throw E.badRequest('revision must be a positive integer');
  ok(req, res, await service.restore(ctxOf(req), idParam(req, 'sectionId'), Number(raw), req.body));
};

exports.duplicate = async (req, res) => ok(req, res, await service.duplicate(ctxOf(req), req.body), 201);
