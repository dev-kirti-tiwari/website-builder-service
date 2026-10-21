'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('../errors');

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const ID_RE = /^[1-9]\d{0,17}$/; // fits PostgreSQL BIGINT

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Authentication + workspace authorization.
 *
 * Headers:
 *   Authorization: Bearer <JWT>        (HS256, signed with JWT_SECRET)  -> who the caller is
 *   X-Workspace-Id: <id>               -> which workspace the caller targets (NOT proof of access)
 *   X-Internal-Service-Token: <token>  -> BFF-to-service secret, enforced only if configured
 *
 * JWT claims: sub (numeric user id), workspaces: [{ id: "<workspaceId>", role: "viewer|editor|admin|owner" }]
 * The caller's workspace membership/role always comes from the verified token, never from headers/body.
 */
function authenticate(config) {
  return (req, _res, next) => {
    if (config.INTERNAL_SERVICE_TOKEN) {
      const supplied = req.get('x-internal-service-token');
      if (!supplied || !safeEqual(supplied, config.INTERNAL_SERVICE_TOKEN)) {
        throw new AppError(401, 'INVALID_SERVICE_TOKEN', 'Missing or invalid internal service token');
      }
    }

    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!match) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Missing or malformed Authorization header (expected "Bearer <token>")');
    }

    let claims;
    try {
      claims = jwt.verify(match[1], config.JWT_SECRET, {
        algorithms: ['HS256'],
        ...(config.JWT_ISSUER ? { issuer: config.JWT_ISSUER } : {}),
        ...(config.JWT_AUDIENCE ? { audience: config.JWT_AUDIENCE } : {}),
      });
    } catch (err) {
      const expired = err && err.name === 'TokenExpiredError';
      throw new AppError(401, expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', expired ? 'Token has expired' : 'Invalid token');
    }

    const userId = String(claims.sub ?? '');
    if (!ID_RE.test(userId)) throw new AppError(401, 'INVALID_TOKEN', 'Token subject is not a valid user id');

    const workspaceId = req.get('x-workspace-id');
    if (!workspaceId) throw new AppError(400, 'WORKSPACE_REQUIRED', 'X-Workspace-Id header is required');
    if (!ID_RE.test(workspaceId)) throw new AppError(400, 'INVALID_WORKSPACE_ID', 'X-Workspace-Id must be a numeric id');

    const memberships = Array.isArray(claims.workspaces) ? claims.workspaces : [];
    const membership = memberships.find((w) => w && String(w.id) === workspaceId);
    if (!membership || !ROLE_RANK[membership.role]) {
      throw new AppError(403, 'WORKSPACE_FORBIDDEN', 'You do not have access to this workspace');
    }

    req.auth = { userId, workspaceId, role: membership.role };
    next();
  };
}

function requireRole(minRole) {
  return (req, _res, next) => {
    if (ROLE_RANK[req.auth.role] < ROLE_RANK[minRole]) {
      throw new AppError(403, 'INSUFFICIENT_ROLE', `This action requires the "${minRole}" role or higher`);
    }
    next();
  };
}

module.exports = { authenticate, requireRole, ROLE_RANK };
