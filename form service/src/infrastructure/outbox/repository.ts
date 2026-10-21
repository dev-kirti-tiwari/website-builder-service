import type { Pool } from 'pg';
import type { Db, Scope } from '../../shared/types';
import { withTransaction } from '../postgres';

export interface OutboxEvent {
  id: string;
  tenantId: string;
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
  requestId: string | null;
  attempts: number;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/** Must be called with the same client/transaction as the business write. */
export async function enqueueOutbox(
  db: Db,
  scope: Scope,
  eventType: string,
  payload: Record<string, unknown>,
  requestId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO outbox_events (tenant_id, organization_id, event_type, payload, request_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [scope.tenantId, scope.organizationId, eventType, JSON.stringify(payload), requestId],
  );
}

export interface BatchResult {
  processed: number;
  retried: number;
  dead: number;
}

/**
 * Claims due events (FOR UPDATE SKIP LOCKED), runs the handler, and either marks them processed,
 * schedules an exponential-backoff retry, or moves them to the dead-letter state ('dead').
 */
export async function processOutboxBatch(
  pool: Pool,
  handler: OutboxHandler,
  opts: { batchSize?: number; maxAttempts?: number; baseDelaySeconds?: number } = {},
): Promise<BatchResult> {
  const { batchSize = 10, maxAttempts = 5, baseDelaySeconds = 5 } = opts;
  const result: BatchResult = { processed: 0, retried: 0, dead: 0 };

  await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, organization_id, event_type, payload, request_id, attempts
         FROM outbox_events
        WHERE status = 'pending' AND next_attempt_at <= NOW()
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );
    for (const r of rows) {
      const event: OutboxEvent = {
        id: r.id,
        tenantId: r.tenant_id,
        organizationId: r.organization_id,
        eventType: r.event_type,
        payload: r.payload,
        requestId: r.request_id,
        attempts: r.attempts,
      };
      try {
        await handler(event);
        await client.query(`UPDATE outbox_events SET status='processed', processed_at=NOW(), attempts=attempts+1 WHERE id=$1`, [event.id]);
        result.processed++;
      } catch (err) {
        const attempts = event.attempts + 1;
        const message = String((err as Error)?.message ?? err).slice(0, 500);
        if (attempts >= maxAttempts) {
          await client.query(`UPDATE outbox_events SET status='dead', attempts=$2, last_error=$3 WHERE id=$1`, [event.id, attempts, message]);
          result.dead++;
        } else {
          const delay = baseDelaySeconds * 2 ** (attempts - 1);
          await client.query(
            `UPDATE outbox_events SET attempts=$2, last_error=$3, next_attempt_at = NOW() + make_interval(secs => $4) WHERE id=$1`,
            [event.id, attempts, message, delay],
          );
          result.retried++;
        }
      }
    }
  });
  return result;
}
