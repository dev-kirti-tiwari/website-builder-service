import type { Pool } from 'pg';
import { log } from '../logger';
import { processOutboxBatch, type OutboxHandler } from './repository';

/**
 * Default handler. CRM / mail / WhatsApp delivery belongs to their owning services and their
 * API contracts are not defined yet, so this only logs the event. Replace it with real
 * dispatchers (idempotent per event id) when those contracts exist.
 */
export const loggingHandler: OutboxHandler = async (event) => {
  log('info', 'outbox event dispatched (no downstream configured)', {
    eventId: event.id,
    eventType: event.eventType,
    requestId: event.requestId,
  });
};

export function startOutboxWorker(pool: Pool, intervalMs: number, handler: OutboxHandler = loggingHandler) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processOutboxBatch(pool, handler);
    } catch (err) {
      log('error', 'outbox batch failed', { error: String((err as Error).message) });
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
