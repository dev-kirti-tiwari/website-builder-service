'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deviceForWidth, resolveResponsive, BREAKPOINTS } = require('../../src/responsive');

test('breakpoint boundaries 767 / 768 / 1023 / 1024', () => {
  assert.equal(deviceForWidth(0), 'phone');
  assert.equal(deviceForWidth(767), 'phone');
  assert.equal(deviceForWidth(768), 'tablet');
  assert.equal(deviceForWidth(1023), 'tablet');
  assert.equal(deviceForWidth(1024), 'laptop');
  assert.equal(deviceForWidth(2560), 'laptop');
  assert.deepEqual(BREAKPOINTS.tablet, { minWidth: 768, maxWidth: 1023 });
});

test('fallback: device override, else base, else undefined', () => {
  const v = { base: '48px', phone: '32px' };
  assert.equal(resolveResponsive(v, 'phone'), '32px');
  assert.equal(resolveResponsive(v, 'tablet'), '48px');
  assert.equal(resolveResponsive(v, 'laptop'), '48px');
  assert.equal(resolveResponsive({ phone: '1px' }, 'laptop'), undefined);
  assert.equal(resolveResponsive('16px', 'phone'), '16px');
  assert.equal(resolveResponsive(undefined, 'phone'), undefined);
});

test('unknown device / invalid width are rejected', () => {
  assert.throws(() => resolveResponsive({ base: '1px' }, 'mobile'), RangeError);
  assert.throws(() => deviceForWidth(-1), RangeError);
  assert.throws(() => deviceForWidth(NaN), RangeError);
});
