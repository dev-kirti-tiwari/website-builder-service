const crypto = require('crypto');

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const requestId = (req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};

const notFound = (req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.'));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  let { status, code, message, details } = err;
  if (err.type === 'entity.parse.failed') {
    status = 400; code = 'MALFORMED_JSON'; message = 'Request body is not valid JSON.';
  }
  if (!status) {
    console.error(JSON.stringify({ level: 'error', requestId: req.id, msg: err.message }));
    status = 500; code = 'INTERNAL_ERROR'; message = 'Unexpected server error.';
  }
  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    meta: { requestId: req.id },
  });
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, requestId, notFound, errorHandler, wrap };
