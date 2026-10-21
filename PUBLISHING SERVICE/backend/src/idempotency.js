const { tx } = require('./db');
const { ApiError } = require('./errors');
const { sha256, stableStringify } = require('./util');

// Runs `work(client)` at most once per (tenant, org, user, route, Idempotency-Key).
// Same key + same request replays the stored response; same key + different request -> 409.
// The key row and the work commit in ONE transaction, so a crash never leaves a half-recorded key.
async function idempotent(req, res, work) {
  const key = req.get('idempotency-key');
  if (!key || key.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header (max 200 chars) is required.');
  }
  const { ctx } = req;
  const path = req.originalUrl.split('?')[0];
  const scope = `${ctx.tenantId}:${ctx.orgId}:${ctx.userId}:${req.method} ${path}`;
  const keyHash = sha256(key);
  const requestHash = sha256(stableStringify({ method: req.method, path, body: req.body || {} }));

  const out = await tx(async (c) => {
    await c.query('DELETE FROM publishing_idempotency_keys WHERE scope=$1 AND key_hash=$2 AND expires_at < now()', [scope, keyHash]);
    const ins = await c.query(
      `INSERT INTO publishing_idempotency_keys (scope, key_hash, request_hash, expires_at)
       VALUES ($1,$2,$3, now() + interval '24 hours') ON CONFLICT DO NOTHING RETURNING scope`,
      [scope, keyHash, requestHash]);
    if (!ins.rowCount) {
      const { rows } = await c.query(
        'SELECT request_hash, status_code, response FROM publishing_idempotency_keys WHERE scope=$1 AND key_hash=$2',
        [scope, keyHash]);
      const prior = rows[0];
      if (prior.request_hash !== requestHash) {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request.');
      }
      return { replay: true, status: prior.status_code, body: prior.response };
    }
    const result = await work(c);
    await c.query(
      'UPDATE publishing_idempotency_keys SET status_code=$3, response=$4 WHERE scope=$1 AND key_hash=$2',
      [scope, keyHash, result.status, JSON.stringify(result.body)]);
    return result;
  });

  if (out.replay) res.set('Idempotent-Replayed', 'true');
  res.status(out.status).json(out.body);
}

module.exports = { idempotent };
