'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://unused';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContent, mergePatch } = require('../../src/modules/content/content.schema');
const { parseId } = require('../../src/utils/ids');

const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('valid content for every section type passes', () => {
  const samples = {
    hero: { heading: 'Hi', primaryButton: { label: 'Go', url: '/signup' } },
    features: { heading: 'F', items: [{ itemKey: 'a', title: 'T' }] },
    images: { items: [{ itemKey: 'a', mediaId: '1', alt: 'x' }] },
    testimonials: { items: [{ itemKey: 'a', quote: 'q', author: 'me' }] },
    pricing: { heading: 'P', plans: [{ itemKey: 'a', name: 'Basic', displayPrice: '9' }] },
    faq: { heading: 'FAQ', items: [{ itemKey: 'a', question: 'q', answer: 'a' }] },
    cta: { heading: 'Go', primaryButton: { label: 'Go', url: 'https://example.com' } },
    form: { heading: 'Contact', helperText: 'help' },
  };
  for (const [type, content] of Object.entries(samples)) assert.deepEqual(validateContent(type, content), content);
});

test('unsafe links are rejected with INVALID_LINK', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.com', 'http://x.com', 'ftp://x.com', ' /a b', 'signup']) {
    assert.equal(code(() => validateContent('cta', { heading: 'x', primaryButton: { label: 'a', url } })), 'INVALID_LINK', url);
  }
  for (const url of ['/signup', '/a?b=1#c', 'https://example.com/x', '#top']) {
    assert.equal(code(() => validateContent('cta', { heading: 'x', primaryButton: { label: 'a', url } })), null, url);
  }
});

test('HTML / script content and unknown keys are rejected', () => {
  assert.equal(code(() => validateContent('hero', { heading: '<script>x</script>' })), 'CONTENT_SCHEMA_INVALID');
  assert.equal(code(() => validateContent('hero', { heading: 'ok', nope: 1 })), 'CONTENT_SCHEMA_INVALID');
  assert.equal(code(() => validateContent('hero', { heading: '   ' })), 'CONTENT_SCHEMA_INVALID');
  assert.equal(code(() => validateContent('hero', { heading: 'Update data: now' })), null);
});

test('media ids must be numeric strings', () => {
  assert.equal(code(() => validateContent('hero', { heading: 'x', mediaId: 'abc' })), 'INVALID_MEDIA_REFERENCE');
  assert.equal(code(() => validateContent('hero', { heading: 'x', mediaId: '0' })), 'INVALID_MEDIA_REFERENCE');
});

test('duplicate itemKeys are rejected', () => {
  const items = [{ itemKey: 'a', question: 'q', answer: 'a' }, { itemKey: 'a', question: 'q2', answer: 'a2' }];
  assert.equal(code(() => validateContent('faq', { heading: 'x', items })), 'CONTENT_SCHEMA_INVALID');
});

test('unknown section type -> SECTION_TYPE_MISMATCH', () => {
  assert.equal(code(() => validateContent('carousel', {})), 'SECTION_TYPE_MISMATCH');
});

test('mergePatch follows RFC 7396 and ignores prototype keys', () => {
  const merged = mergePatch({ a: 1, b: { c: 2, d: 3 }, list: [1, 2] }, { b: { c: null, e: 4 }, list: [9], a: 5 });
  assert.deepEqual(merged, { a: 5, b: { d: 3, e: 4 }, list: [9] });
  const evil = mergePatch({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"ok":1}'));
  assert.deepEqual(evil, { ok: 1 });
  assert.equal({}.polluted, undefined);
});

test('parseId accepts only positive BIGINT decimals', () => {
  assert.equal(parseId('123'), '123');
  assert.equal(parseId('9223372036854775807'), '9223372036854775807');
  for (const bad of ['0', '-1', '01', '1.5', 'abc', '9223372036854775808', '', ' 1', '1;DROP']) assert.equal(parseId(bad), null, bad);
});
