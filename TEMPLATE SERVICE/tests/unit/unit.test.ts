import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env';
import { isBigIntId } from '../../src/lib/bigint';
import { canonicalJson, checksumOf } from '../../src/lib/hash';
import { createLogger } from '../../src/lib/logger';
import { validateSnapshot } from '../../src/modules/versions/snapshot';
import { snapshot } from '../helpers';

describe('BIGINT ids', () => {
  it('accepts exact values above 2^53 and the BIGINT max, rejects everything else', () => {
    expect(isBigIntId('9007199254740993')).toBe(true);
    expect(isBigIntId('9223372036854775807')).toBe(true);
    for (const bad of ['9223372036854775808', '0', '01', '-1', '1.5', '1e3', ' 1', '', 12, null]) expect(isBigIntId(bad)).toBe(false);
  });
});

describe('checksum', () => {
  it('is independent of key order and sensitive to content', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(checksumOf({ a: 1, b: 2 })).toBe(checksumOf({ b: 2, a: 1 }));
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
    expect(checksumOf({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('snapshot validation', () => {
  it('accepts the report example', () => expect(validateSnapshot(snapshot()).pages).toHaveLength(1));
  it('rejects unknown block types, script markup, javascript: urls and extra keys', () => {
    const bad = (mutate: (s: any) => void) => {
      const s: any = snapshot();
      mutate(s);
      return () => validateSnapshot(s);
    };
    expect(bad((s) => (s.pages[0].sections[0].type = 'evil'))).toThrow();
    expect(bad((s) => (s.pages[0].sections[0].props.heading = '<script>alert(1)</script>'))).toThrow();
    expect(bad((s) => (s.pages[0].sections[0].props.href = 'javascript:alert(1)'))).toThrow();
    expect(bad((s) => (s.navigation[0].href = 'data:text/html;base64,xx'))).toThrow();
    expect(bad((s) => (s.pages[0].sections[0].assetRefs = [8801]))).toThrow();
    expect(bad((s) => (s.extra = true))).toThrow();
  });
});

describe('config + logger', () => {
  it('refuses stub integrations and placeholder token in production', () => {
    const base = { DATABASE_URL: 'postgresql://x', NODE_ENV: 'production' };
    expect(() => loadConfig({ ...base, STATIC_INTERNAL_TOKEN: 'a'.repeat(32), INTEGRATIONS_MODE: 'stub' })).toThrow(/stub/);
    expect(() => loadConfig({ ...base, STATIC_INTERNAL_TOKEN: 'replace_me_replace_me', INTEGRATIONS_MODE: 'http' })).toThrow(/placeholder/);
  });
  it('redacts sensitive fields', () => {
    const lines: string[] = [];
    createLogger('info', (l) => lines.push(l)).info('x', { authorization: 'Bearer secret', token: 't', ok: 1 });
    expect(lines[0]).not.toContain('secret');
    expect(lines[0]).toContain('"ok":1');
  });
});
