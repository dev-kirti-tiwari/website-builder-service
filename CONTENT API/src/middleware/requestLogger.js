'use strict';
const logger = require('../utils/logger');

/** One structured line per request. Never logs headers, tokens or bodies. */
module.exports = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      requestId: req.id,
      method: req.method,
      route: req.route ? `${req.baseUrl}${req.route.path}` : req.path,
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6,
      actorId: req.actor?.id,
      workspaceId: req.workspaceId,
      sectionId: req.params?.sectionId,
      errorCode: res.locals.errorCode,
    }, 'request');
  });
  next();
};
