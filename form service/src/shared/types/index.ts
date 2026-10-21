import type { Pool, PoolClient } from 'pg';

export type Db = Pool | PoolClient;

/** Typed tenant/organization scope. Every repository function requires one. */
export interface Scope {
  readonly tenantId: string;
  readonly organizationId: string;
}

export interface Actor extends Scope {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly softwareId?: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      actor?: Actor;
    }
  }
}
