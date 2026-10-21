import { createHash } from 'node:crypto';

/** Deterministic JSON (object keys sorted) so equal documents always produce equal checksums. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const checksumOf = (value: unknown) => sha256Hex(canonicalJson(value));
