import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { log } from '../infrastructure/logger';
import { AppError } from '../shared/errors';

export const routeNotFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: unknown[] = [];

  if (err instanceof AppError) {
    ({ status, code, message } = err);
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  } else {
    log('error', 'unhandled error', { requestId: req.requestId, error: String(err?.message ?? err) });
  }

  res.status(status).json({
    success: false,
    error: { code, message, details },
    meta: { requestId: req.requestId },
  });
};
