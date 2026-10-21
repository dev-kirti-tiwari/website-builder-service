const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const ROLES = new Set(['viewer', 'editor', 'admin']);
const digits = (v) => (typeof v === 'string' || typeof v === 'number') && /^[1-9]\d{0,17}$/.test(String(v)) ? String(v) : null;

function internalTokenValid(token) {
  if (!env.internalServiceToken) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env.internalServiceToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Claim shape (adapt to the existing auth system): workspaces: ["1001", {"id":"1002","role":"viewer"}]
function workspacesFromClaims(claims) {
  const map = new Map();
  if (!Array.isArray(claims.workspaces)) return map;
  for (const w of claims.workspaces) {
    if (w && typeof w === 'object') {
      const id = digits(w.id);
      if (id) map.set(id, ROLES.has(w.role) ? w.role : 'editor');
    } else {
      const id = digits(w);
      if (id) map.set(id, 'editor');
    }
  }
  return map;
}

module.exports = (req, res, next) => {
  const internal = req.get('X-Internal-Service-Token');
  if (internal) {
    if (!internalTokenValid(internal)) return next(new AppError(401, 'INVALID_TOKEN', 'Invalid internal service token.'));
    req.auth = { actorId: digits(req.get('X-Actor-Id')), mode: 'internal' };
    return next();
  }

  if (env.authMode === 'dev') {
    req.auth = { actorId: digits(req.get('X-Actor-Id')) || '1', mode: 'dev' };
    return next();
  }

  const match = /^Bearer (.+)$/i.exec(req.get('Authorization') || '');
  if (!match) return next(new AppError(401, 'AUTHORIZATION_REQUIRED', 'Authentication is required.'));
  try {
    const claims = jwt.verify(match[1], env.jwtKey, {
      algorithms: env.jwtAlgorithms,
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    });
    req.auth = { actorId: digits(claims.sub), mode: 'jwt', workspaces: workspacesFromClaims(claims) };
    return next();
  } catch (e) {
    return next(new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token.'));
  }
};
