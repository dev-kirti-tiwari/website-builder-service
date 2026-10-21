'use strict';
// Usage: npm run token -- [sub] [workspaceIds,comma] [permissions,comma]
//   npm run token -- 9001 1001,1002 "content:*"
const { sign } = require('./lib/tokens');

const [sub = '9001', ws = '1001', perms = 'content:*'] = process.argv.slice(2);
console.log(sign({ sub, workspaces: ws.split(',').map(Number), permissions: perms.split(',') }));
