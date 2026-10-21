'use strict';
// Writes postman/Content-API-Local.postman_environment.local.json (git-ignored) with real local tokens.
const fs = require('node:fs');
const path = require('node:path');
const { buildEnvironment } = require('./build-postman');
const { localTokens } = require('./lib/tokens');

const out = path.join(__dirname, '..', 'postman', 'Content-API-Local.postman_environment.local.json');
const env = buildEnvironment({ ...localTokens(), internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || '' });
fs.writeFileSync(out, JSON.stringify(env, null, 2));
console.log(`wrote ${path.relative(process.cwd(), out)} (git-ignored; contains tokens)`);
