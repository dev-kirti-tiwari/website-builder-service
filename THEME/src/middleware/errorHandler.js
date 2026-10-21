'use strict';

const { AppError } = require('../errors');

function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found'));
}

// Standard error envelope: { success:false, error:{ code, message, details? }, requestId }
function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err && err.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body is not valid JSON';
    } else if (err && err.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body is too large';
    } else if (err && err.code === '23505' && /slug/.test(err.constraint || '')) {
      status = 409;
      code = 'THEME_SLUG_CONFLICT';
      message = 'A theme with this slug already exists in the workspace';
    } else if (err && err.code === '22003') {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'A numeric value is out of range';
    }

    if (status >= 500) {
      // Diagnostics stay in the protected logs; the client only gets a generic message.
      (req.log || logger).error({ err: { message: err && err.message, stack: err && err.stack } }, 'Unhandled error');
    }

    res.status(status).json({
      success: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      requestId: req.id,
    });
  };
}

module.exports = { notFoundHandler, errorHandler };
