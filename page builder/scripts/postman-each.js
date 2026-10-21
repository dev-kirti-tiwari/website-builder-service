// Runs EVERY request of the Postman collection on its own (fresh state) with newman and reports per request.
// Usage: npm run postman:each
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const col = require('../postman/page-builder.postman_collection.json');

const flat = [];
(function walk(items, dir) {
  for (const it of items) {
    if (it.item) walk(it.item, it.name);
    else flat.push({ folder: dir, name: it.name, method: it.request.method });
  }
}(col.item, ''));

const report = path.join(os.tmpdir(), 'pb-newman.json');
let failed = 0;
for (const r of flat) {
  fs.rmSync(report, { force: true });
  spawnSync('npx.cmd', ['--yes', 'newman', 'run', 'postman/page-builder.postman_collection.json',
    '-e', 'postman/local.postman_environment.json', '--folder', `"${r.name}"`,
    '--reporters', 'json', '--reporter-json-export', `"${report}"`],
  { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: true });

  let line;
  try {
    const run = JSON.parse(fs.readFileSync(report, 'utf8')).run;
    const exec = run.executions.find((e) => e.item.name === r.name);
    const code = exec && exec.response ? exec.response.code : '---';
    const bad = run.failures.map((f) => `${f.error.name}: ${f.error.test || f.error.message}`);
    const ok = exec && !bad.length && !run.failures.length;
    if (!ok) failed += 1;
    line = `${ok ? 'PASS' : 'FAIL'}  ${r.method.padEnd(6)} ${code}  ${r.folder} / ${r.name}${bad.length ? `\n      ${bad.slice(0, 3).join('\n      ')}` : ''}`;
  } catch (e) {
    failed += 1;
    line = `FAIL  ${r.method.padEnd(6)} ---  ${r.folder} / ${r.name} (no report: ${e.message})`;
  }
  console.log(line);
}
console.log(`\n${flat.length - failed}/${flat.length} requests passed standalone`);
process.exit(failed ? 1 : 0);
