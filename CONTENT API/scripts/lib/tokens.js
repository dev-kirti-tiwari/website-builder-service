'use strict';
require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');

/** Local/dev tokens signed with JWT_SECRET (HS256). Real deployments use the existing BRR/JWT issuer. */
function sign({ sub, workspaces, permissions, expiresIn = '8h' }) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in .env to mint local tokens');
  return jwt.sign({ workspaces, permissions }, process.env.JWT_SECRET, { subject: String(sub), expiresIn, algorithm: 'HS256' });
}

function localTokens() {
  return {
    // editor with access to workspaces 1001 and 1002 (1002 is used for isolation tests)
    jwtToken: sign({ sub: 9001, workspaces: [1001, 1002], permissions: ['content:*'] }),
    // read-only member of 1001
    viewerToken: sign({ sub: 9002, workspaces: [1001], permissions: ['content:read'] }),
    // valid token, but belongs to a different workspace
    outsiderToken: sign({ sub: 9003, workspaces: [2002], permissions: ['content:*'] }),
  };
}

module.exports = { sign, localTokens };
