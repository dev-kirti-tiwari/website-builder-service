import { unavailable } from '../lib/errors';
import type { RequestContext } from '../types';

/**
 * Adapter interfaces for services this microservice does NOT own (report section 9).
 * The real Website / Document-Draft / Media contracts are unconfirmed, so no endpoint paths are invented:
 * `stub` mode gives local-development behaviour; `http` mode fails closed with 503 until a contract is wired.
 */
export interface WebsiteClient {
  /** Verify the website belongs to the caller's tenant + organization. Must throw (404/403/503) otherwise; fail closed. */
  assertWebsiteInScope(ctx: RequestContext, websiteId: string): Promise<void>;
}

export interface MediaClient {
  /** Verify every asset exists and is accessible to the caller's scope. Never uploads bytes. */
  assertAssetsAccessible(ctx: RequestContext, assetIds: string[]): Promise<void>;
}

export type DraftFromTemplateInput = {
  /** Stable operation ID: retries and reconciliation MUST reuse it so the downstream service dedupes. */
  operationId: string;
  websiteId: string;
  websiteName?: string;
  templateId: string;
  templateVersionId: string;
  checksum: string;
  snapshot: unknown;
  includeDemoContent: boolean;
  locale?: string;
};

export interface DocumentDraftClient {
  /** Creates an editable DRAFT from an exact template version. Never publishes. Idempotent per operationId. */
  createDraftFromTemplate(ctx: RequestContext, input: DraftFromTemplateInput): Promise<{ documentId: string }>;
}

export type Integrations = {
  website: WebsiteClient;
  media: MediaClient;
  documents: DocumentDraftClient;
  ready(): Promise<boolean>;
};

/** Local-development adapters. Never allowed in production (see config). */
export function createStubIntegrations(): Integrations {
  return {
    website: { assertWebsiteInScope: async () => undefined },
    media: { assertAssetsAccessible: async () => undefined },
    documents: {
      // Deterministic per operation: a retry with the same operationId returns the same document (idempotent).
      createDraftFromTemplate: async (_ctx, input) => ({ documentId: String(BigInt(input.operationId) + 1_000_000_000_000n) }),
    },
    ready: async () => true,
  };
}

/** Fails closed until real service contracts are confirmed and implemented. */
export function createHttpIntegrations(): Integrations {
  const notConfigured = (): never => {
    throw unavailable('INTEGRATION_CONTRACT_NOT_CONFIGURED', 'Downstream service contract is not configured');
  };
  return {
    website: { assertWebsiteInScope: async () => notConfigured() },
    media: { assertAssetsAccessible: async () => notConfigured() },
    documents: { createDraftFromTemplate: async () => notConfigured() },
    ready: async () => false,
  };
}
