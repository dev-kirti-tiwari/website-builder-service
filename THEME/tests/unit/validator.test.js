'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateThemeConfig } = require('../../src/services/themeValidator');
const { mergePatch, slugify } = require('../../src/services/themeService');
const { fullTheme } = require('../../fixtures/fullTheme');

const paths = (r) => r.errors.map((e) => `${e.path}:${e.code}`);

test('full fixture is valid for activation', () => {
  const r = validateThemeConfig(fullTheme(), { activation: true });
  assert.deepEqual(r.errors, []);
});

test('empty draft is valid but not activation-ready', () => {
  assert.deepEqual(validateThemeConfig({ schemaVersion: 1 }).errors, []);
  const r = validateThemeConfig({ schemaVersion: 1 }, { activation: true });
  assert.ok(r.errors.some((e) => e.code === 'REQUIRED_FOR_ACTIVATION' && e.path === 'colors.primary'));
});

test('unknown keys and unknown device keys are rejected with precise paths', () => {
  const c = fullTheme();
  c.evil = 1;
  c.typography.h1.fontSize.mobile = '10px';
  const p = paths(validateThemeConfig(c));
  assert.ok(p.includes('evil:UNKNOWN_KEY'));
  assert.ok(p.includes('typography.h1.fontSize.mobile:UNKNOWN_KEY'));
});

test('unsafe values are rejected (no raw CSS / script / url)', () => {
  for (const bad of ['url(javascript:alert(1))', 'red; background:url(x)', '<script>', 'expression(1)', '#GGGGGG', 'rgb(0,0,0); x']) {
    const c = { colors: { primary: bad } };
    assert.ok(paths(validateThemeConfig(c)).includes('colors.primary:INVALID_VALUE'), bad);
  }
});

test('dimension units and bounds', () => {
  assert.deepEqual(validateThemeConfig({ spacing: { md: '16px' } }).errors, []);
  assert.deepEqual(validateThemeConfig({ spacing: { md: '2rem' } }).errors, []);
  assert.ok(validateThemeConfig({ spacing: { md: '16' } }).errors.length);
  assert.ok(validateThemeConfig({ spacing: { md: '600px' } }).errors.length);
  assert.ok(validateThemeConfig({ spacing: { md: '16pt' } }).errors.length);
  assert.ok(validateThemeConfig({ layout: { containerWidth: '100px' } }).errors.length);
});

test('token references: resolve, missing, cycle, chain', () => {
  assert.deepEqual(validateThemeConfig({ colors: { primary: '#fff', accent: '{colors.primary}', muted: '{colors.accent}' } }).errors, []);
  assert.ok(paths(validateThemeConfig({ colors: { accent: '{colors.nope}' } })).includes('colors.accent:REF_MISSING'));
  const cyc = paths(validateThemeConfig({ colors: { primary: '{colors.secondary}', secondary: '{colors.primary}' } }));
  assert.ok(cyc.includes('colors.primary:REF_CYCLE'));
  assert.ok(cyc.includes('colors.secondary:REF_CYCLE'));
  // a color field may not reference a non-color token
  assert.ok(validateThemeConfig({ colors: { primary: '{radius.md}' } }).errors.length);
});

test('gradient stops must be ordered and 2-10 long', () => {
  const g = (stops) => ({ backgrounds: { page: { type: 'gradient', angle: 0, stops } } });
  assert.deepEqual(validateThemeConfig(g([{ color: '#000', position: 0 }, { color: '#fff', position: 100 }])).errors, []);
  assert.ok(paths(validateThemeConfig(g([{ color: '#000', position: 50 }, { color: '#fff', position: 10 }])))
    .includes('backgrounds.page.stops[1].position:GRADIENT_STOPS_UNORDERED'));
  assert.ok(validateThemeConfig(g([{ color: '#000', position: 0 }])).errors.length);
});

test('image background only accepts a numeric Media asset id', () => {
  const ok = { backgrounds: { page: { type: 'image', assetId: '123', fit: 'cover' } } };
  assert.deepEqual(validateThemeConfig(ok).errors, []);
  const bad = { backgrounds: { page: { type: 'image', assetId: 'https://x/y.png' } } };
  assert.ok(validateThemeConfig(bad).errors.length);
});

test('breakpoints are a fixed contract', () => {
  assert.deepEqual(validateThemeConfig(fullTheme()).errors, []);
  const c = fullTheme();
  c.responsive.breakpoints.phone.maxWidth = 600;
  assert.ok(validateThemeConfig(c).errors.length);
});

test('low contrast produces a warning, not an error', () => {
  const c = { colors: { heading: '#CCCCCC', background: '#FFFFFF' } };
  const r = validateThemeConfig(c);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.code === 'LOW_CONTRAST' && w.path === 'colors.heading'));
});

test('mergePatch: merge objects, replace arrays, null deletes, ignores __proto__', () => {
  const target = { a: { x: 1, y: 2 }, list: [1, 2], keep: true };
  const out = mergePatch(target, { a: { y: 3, z: 4 }, list: [9], keep: null });
  assert.deepEqual(out, { a: { x: 1, y: 3, z: 4 }, list: [9] });
  assert.deepEqual(target, { a: { x: 1, y: 2 }, list: [1, 2], keep: true }, 'input not mutated');
  const evil = mergePatch({}, JSON.parse('{"__proto__": {"polluted": true}}'));
  assert.equal({}.polluted, undefined);
  assert.equal(evil.polluted, undefined);
});

test('slugify', () => {
  assert.equal(slugify('Ocean Blue!'), 'ocean-blue');
  assert.equal(slugify('  Crème Brûlée  '), 'creme-brulee');
  assert.equal(slugify('!!!'), 'theme');
  assert.ok(slugify('a'.repeat(500)).length <= 160);
});
