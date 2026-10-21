'use strict';
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { E } = require('../utils/errors');

const verifyOptions = {
  algorithms: env.jwt.publicKey ? ['RS256', 'ES256'] : ['HS256'],
  ...(env.jwt.issuer && { issuer: env.jwt.issuer }),
  ...(env.jwt.audience && { audience: env.jwt.audience }),
};
const key = env.jwt.publicKey || env.jwt.secret;

const toIdList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String);

/**
 * Authenticates BRR/JWT from `Authorization: Bearer <token>` only.
 * Expected claims: sub (actor id), workspaces[] (or workspaceId), permissions[].
 */
function authenticate(req, res, next) {
  const header = req.get('authorization');
  if (!header) return next(E.authRequired());
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return next(E.invalidToken());
  let claims;
  try {
    claims = jwt.verify(m[1], key, verifyOptions);
  } catch {
    return next(E.invalidToken());
  }
  if (!claims.sub) return next(E.invalidToken());
  const actorId = String(claims.sub);
  req.actor = {
    id: /^\d+$/.test(actorId) ? actorId : null, // BIGINT columns only accept numeric ids
    subject: actorId,
    type: 'user',
    workspaces: new Set([...toIdList(claims.workspaces), ...toIdList(claims.workspaceId)]),
    permissions: new Set(toIdList(claims.permissions)),
  };
  next();
}

function timingSafeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Trusted internal callers (BFF / other services) authenticate with X-Internal-Service-Token. */
function authenticateInternal(req, res, next) {
  const token = req.get('x-internal-service-token');
  if (!token) return next(E.authRequired());
  if (!env.internalServiceToken || !timingSafeEqual(token, env.internalServiceToken)) return next(E.invalidToken());
  const actorId = req.get('x-actor-id');
  req.actor = { id: /^\d+$/.test(actorId || '') ? actorId : null, subject: 'internal-service', type: 'service', internal: true };
  next();
}

module.exports = { authenticate, authenticateInternal };
