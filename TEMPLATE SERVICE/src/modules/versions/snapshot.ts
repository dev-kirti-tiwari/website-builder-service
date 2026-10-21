import { z } from 'zod';
import { unprocessable } from '../../lib/errors';
import { isBigIntId } from '../../lib/bigint';

/**
 * Template snapshot contract (report section 8). The block catalogue below is the ILLUSTRATIVE contract from the
 * report; align BLOCK_TYPES / props with the real Visual Editor schema once it is confirmed.
 */
export const SCHEMA_VERSION = 1;
export const BLOCK_TYPES = ['hero', 'text', 'image', 'gallery', 'features', 'cta', 'header', 'footer', 'contact', 'testimonials', 'pricing', 'faq'] as const;

const MAX_PAGES = 50;
const MAX_SECTIONS_PER_PAGE = 100;
const MAX_ASSET_REFS = 500;
const MAX_BYTES = 1_000_000;

// Only same-site paths, anchors, https and mailto/tel links. Blocks javascript:, data:, vbscript:, protocol-relative, etc.
const safeUrl = z
  .string()
  .max(2048)
  .refine((v) => /^(\/(?!\/)|#|https:\/\/|mailto:|tel:)/i.test(v), 'href must be a relative path, #anchor, https:, mailto: or tel: URL');

const assetId = z.string().refine(isBigIntId, 'asset reference must be a BIGINT decimal string');

const section = z
  .object({
    type: z.enum(BLOCK_TYPES),
    props: z.record(z.string().max(64), z.unknown()).default({}),
    assetRefs: z.array(assetId).max(50).default([]),
  })
  .strict();

const page = z
  .object({
    slug: z.string().min(1).max(200).regex(/^\/[a-z0-9\-/]*$/, 'page slug must be a lowercase path starting with /'),
    title: z.string().min(1).max(200),
    sections: z.array(section).max(MAX_SECTIONS_PER_PAGE),
  })
  .strict();

export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    metadata: z.object({ name: z.string().min(1).max(160), locale: z.string().min(2).max(20).optional() }).strict(),
    theme: z
      .object({ tokens: z.record(z.string().max(64), z.union([z.string().max(200), z.number()])).default({}) })
      .strict()
      .default({ tokens: {} }),
    pages: z.array(page).min(1).max(MAX_PAGES),
    navigation: z.array(z.object({ label: z.string().min(1).max(100), href: safeUrl }).strict()).max(100).default([]),
  })
  .strict();

export type Snapshot = z.infer<typeof snapshotSchema>;

const DANGEROUS = /<\s*\/?\s*(script|iframe|object|embed)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon[a-z]+\s*=/i;

/** Walk every string in props: no executable markup, and any `href`/`src`/`url` key must be a safe URL. */
function scanProps(value: unknown, path: string, depth: number, issues: { path: string; message: string }[]): void {
  if (issues.length >= 20) return;
  if (depth > 8) {
    issues.push({ path, message: 'props nested too deeply (max 8 levels)' });
    return;
  }
  if (typeof value === 'string') {
    if (DANGEROUS.test(value)) issues.push({ path, message: 'contains executable markup or a dangerous URL scheme' });
  } else if (Array.isArray(value)) {
    if (value.length > 500) issues.push({ path, message: 'array too large (max 500)' });
    value.slice(0, 500).forEach((v, i) => scanProps(v, `${path}[${i}]`, depth + 1, issues));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/^(href|src|url|link)$/i.test(k) && typeof v === 'string' && !safeUrl.safeParse(v).success) {
        issues.push({ path: `${path}.${k}`, message: 'unsafe URL scheme' });
      }
      scanProps(v, `${path}.${k}`, depth + 1, issues);
    }
  }
}

/** Validate an untrusted snapshot; throws 422 with field-level details. Returns the parsed, defaulted snapshot. */
export function validateSnapshot(input: unknown): Snapshot {
  if (Buffer.byteLength(JSON.stringify(input ?? null)) > MAX_BYTES) {
    throw unprocessable('SNAPSHOT_TOO_LARGE', `snapshot exceeds ${MAX_BYTES} bytes`);
  }
  const r = snapshotSchema.safeParse(input);
  if (!r.success) {
    throw unprocessable(
      'SNAPSHOT_INVALID',
      'Snapshot does not match the template snapshot schema',
      r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const issues: { path: string; message: string }[] = [];
  r.data.pages.forEach((p, pi) => p.sections.forEach((s, si) => scanProps(s.props, `pages.${pi}.sections.${si}.props`, 0, issues)));
  if (collectAssetRefs(r.data).length > MAX_ASSET_REFS) issues.push({ path: 'pages', message: `more than ${MAX_ASSET_REFS} asset references` });
  if (issues.length) throw unprocessable('SNAPSHOT_UNSAFE', 'Snapshot contains unsafe or oversized content', issues);
  return r.data;
}

export function collectAssetRefs(s: Snapshot): string[] {
  const ids = new Set<string>();
  for (const p of s.pages) for (const sec of p.sections) for (const a of sec.assetRefs) ids.add(a);
  return [...ids];
}
