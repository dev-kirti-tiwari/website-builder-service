const service = require('./section.service');
const { ctxOf, send } = require('../../utils/http');

const reply = (req, res, { data, revision }, status = 200) =>
  send(req, res, data, { status, meta: { revision } });

exports.add = async (req, res) =>
  reply(req, res, await service.add(ctxOf(req), req.valid.params.id, req.valid.body), 201);

exports.update = async (req, res) => {
  const { id, sectionId } = req.valid.params;
  reply(req, res, await service.update(ctxOf(req), id, sectionId, req.valid.body));
};

exports.duplicate = async (req, res) => {
  const { id, sectionId } = req.valid.params;
  reply(req, res, await service.duplicate(ctxOf(req), id, sectionId, req.valid.body.expectedRevision), 201);
};

exports.remove = async (req, res) => {
  const { id, sectionId } = req.valid.params;
  reply(req, res, await service.remove(ctxOf(req), id, sectionId, req.valid.body.expectedRevision));
};

exports.reorder = async (req, res) =>
  reply(req, res, await service.reorder(ctxOf(req), req.valid.params.id, req.valid.body));
