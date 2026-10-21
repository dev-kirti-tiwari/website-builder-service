const config = require('./config');
const { q, tx } = require('./db');
const { sha256, stableStringify, validateContent } = require('./util');
const { activateRelease } = require('./service');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class StageError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Provider-independent adapter. This mock stands in for the real hosting adapter, which must only be
// implemented after the Website Builder's runtime is audited. Failure injection is driven by
// snapshot.simulateFailure ('deploy' | 'verify' | 'propagate') and only fires on the first attempt.
const provider = {
  async deploy(rel) { return `mock-deploy-${rel.id}`; },
  async verify() { return true; },
  async propagate() { return true; },
};

const event = (id, stage, message) => q(
  'INSERT INTO publishing_deployment_events (deployment_id, stage, message) VALUES ($1,$2,$3)', [id, stage, message]);

async function processDeployment(id) {
  const dep = (await q('SELECT * FROM publishing_deployments WHERE id=$1', [id])).rows[0];
  if (!dep || dep.status === 'succeeded' || dep.kind !== 'publish') return;

  const n = (await q('SELECT count(*)::int AS n FROM publishing_deployment_attempts WHERE deployment_id=$1', [id])).rows[0].n;
  const attemptNo = n + 1;
  const attempt = (await q(
    'INSERT INTO publishing_deployment_attempts (deployment_id, attempt_number) VALUES ($1,$2) RETURNING id', [id, attemptNo])).rows[0];
  const step = async (status, msg) => {
    await q('UPDATE publishing_deployments SET status=$2, updated_at=now() WHERE id=$1', [id, status]);
    await event(id, status, msg);
    await sleep(config.stageDelayMs);
  };

  let rel;
  try {
    rel = (await q('SELECT * FROM publishing_releases WHERE id=$1', [dep.release_id])).rows[0];
    const sim = (stage) => {
      if (attemptNo === 1 && rel.snapshot.simulateFailure === stage) throw new StageError(`PROVIDER_${stage.toUpperCase()}_FAILED`);
    };
    let providerRef = null;

    if (rel.status !== 'active') {
      await step('validating', 'Validating release input');
      if (validateContent(rel.snapshot).length) throw new StageError('VALIDATION_FAILED');
      await step('preparing', 'Verifying immutable snapshot integrity');
      if (sha256(stableStringify(rel.snapshot)) !== rel.content_hash) throw new StageError('INTEGRITY_CHECK_FAILED');
      await step('deploying', 'Deploying release to hosting provider');
      sim('deploy');
      providerRef = await provider.deploy(rel);
      await step('verifying', 'Checking deployment readiness');
      sim('verify');
      await provider.verify(providerRef);
      await step('activating', 'Activating release');
      await tx((c) => activateRelease(c, rel.website_id, rel.id));
    }

    // Past activation, a propagation failure leaves the release live and is recovered by retry.
    await step('propagating', 'Propagating routing and cache');
    sim('propagate');
    await provider.propagate();

    await q("UPDATE publishing_deployments SET status='succeeded', propagation_status='completed', error_code=NULL, updated_at=now() WHERE id=$1", [id]);
    await q("UPDATE publishing_deployment_attempts SET status='succeeded', provider_ref=$2, ended_at=now() WHERE id=$1", [attempt.id, providerRef]);
    await event(id, 'succeeded', 'Release is live');
  } catch (e) {
    const code = e instanceof StageError ? e.code : 'INTERNAL_ERROR';
    if (!(e instanceof StageError)) console.error(JSON.stringify({ level: 'error', deploymentId: id, msg: e.message }));
    const live = rel && (await q('SELECT status FROM publishing_releases WHERE id=$1', [rel.id])).rows[0].status === 'active';
    if (rel && !live) await q("UPDATE publishing_releases SET status='failed' WHERE id=$1", [rel.id]);
    await q(
      "UPDATE publishing_deployments SET status='failed', error_code=$2, propagation_status=$3, updated_at=now() WHERE id=$1",
      [id, code, live ? 'failed' : 'not_started']);
    await q("UPDATE publishing_deployment_attempts SET status='failed', error_code=$2, ended_at=now() WHERE id=$1", [attempt.id, code]);
    await event(id, 'failed', `Deployment failed: ${code}${live ? ' (release remains live; propagation pending retry)' : ' (previous live release preserved)'}`);
  }
}

// Claims one pending outbox event with a lease (SKIP LOCKED), so multiple workers never double-process
// and a crashed worker's event is re-claimed after the lease expires.
async function claim() {
  const { rows } = await q(
    `UPDATE publishing_outbox_events SET attempts = attempts + 1, locked_until = now() + make_interval(secs => $1)
     WHERE id = (SELECT id FROM publishing_outbox_events
                 WHERE processed_at IS NULL AND (locked_until IS NULL OR locked_until < now())
                 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`, [config.leaseSeconds]);
  return rows[0];
}

let running = false;
async function start() {
  running = true;
  while (running) {
    try {
      const ev = await claim();
      if (!ev) { await sleep(300); continue; }
      await processDeployment(ev.aggregate_id);
      await q('UPDATE publishing_outbox_events SET processed_at=now() WHERE id=$1', [ev.id]);
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: `worker: ${e.message}` }));
      await sleep(1000);
    }
  }
}
const stop = () => { running = false; };

module.exports = { start, stop };
