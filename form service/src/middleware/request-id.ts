import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Accepts a well-formed X-Request-Id, otherwise generates one (prevents log injection). */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : `req_${randomUUID()}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
