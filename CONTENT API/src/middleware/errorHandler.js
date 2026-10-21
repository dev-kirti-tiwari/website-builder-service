'use strict';
const { ApiError, E } = require('../utils/errors');
const logger = require('../utils/logger');

const body = (req, err) => ({
  success: false,
  error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
  meta: { requestId: req.id },
});

function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', 'Route not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let apiErr = err;
  if (!(err instanceof ApiError)) {
    if (err.type === 'entity.too.large') apiErr = E.tooLarge();
    else if (err.type === 'entity.parse.failed') apiErr = E.badRequest('Request body is not valid JSON');
    else if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') apiErr = E.unsupportedMedia();
    else {
      logger.error({ requestId: req.id, err: { name: err.name, message: err.message, code: err.code, stack: err.stack } }, 'unhandled error');
      apiErr = E.internal();
    }
  }
  res.locals.errorCode = apiErr.code;
  if (res.headersSent) return;
  res.status(apiErr.status).json(body(req, apiErr));
}

module.exports = { errorHandler, notFound };
