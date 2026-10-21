'use strict';

/**
 * Generate a development JWT for the Theme API.
 *   npm run token -- --sub 1001 --workspaces 1:admin,2:viewer --expires 8h
 */
const jwt = require('jsonwebtoken');
const { loadConfig } = require('../src/config');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const config = loadConfig();
const workspaces = arg('workspaces', '1:admin')
  .split(',')
  .map((pair) => {
    const [id, role] = pair.split(':');
    return { id: String(id), role: role || 'editor' };
  });

const token = jwt.sign({ sub: arg('sub', '1001'), workspaces }, config.JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: arg('expires', '8h'),
  ...(config.JWT_ISSUER ? { issuer: config.JWT_ISSUER } : {}),
  ...(config.JWT_AUDIENCE ? { audience: config.JWT_AUDIENCE } : {}),
});
console.log(token);
