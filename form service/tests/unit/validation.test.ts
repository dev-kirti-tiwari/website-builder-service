import { describe, expect, it } from 'vitest';
import { hasPermission } from '../../src/middleware/authorization';
import { checkFieldRules } from '../../src/modules/fields/schemas';
import { slugify } from '../../src/shared/validation/slug';
import { validateSubmission, type PublishedSchema } from '../../src/shared/validation/submission';

const schema: PublishedSchema = {
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, validation: { minLength: 2, maxLength: 10 } },
    { name: 'email', label: 'Email', type: 'email', required: false },
    { name: 'age', label: 'Age', type: 'number', required: false, validation: { min: 18, max: 99 } },
    { name: 'topic', label: 'Topic', type: 'select', required: false, options: ['a', 'b'] },
    { name: 'agree', label: 'Agree', type: 'checkbox', required: false },
    { name: 'dob', label: 'DOB', type: 'date', required: false },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
  ],
};

describe('submission validation', () => {
  it('accepts a valid payload', () => {
    expect(validateSubmission(schema, { name: 'Ana', email: 'a@b.co', age: 30, topic: 'a', agree: true, dob: '2000-02-29', phone: '+91 98765 43210' })).toEqual([]);
  });
  it('rejects unknown fields', () => {
    expect(validateSubmission(schema, { name: 'Ana', tenant_id: '2' })).toEqual([{ field: 'tenant_id', message: 'unknown field' }]);
  });
  it('requires required fields', () => {
    expect(validateSubmission(schema, {})).toEqual([{ field: 'name', message: 'is required' }]);
  });
  it.each([
    [{ name: 'A' }, 'name'],
    [{ name: 'x'.repeat(11) }, 'name'],
    [{ name: 'Ana', email: 'nope' }, 'email'],
    [{ name: 'Ana', age: '30' }, 'age'],
    [{ name: 'Ana', age: 5 }, 'age'],
    [{ name: 'Ana', topic: 'c' }, 'topic'],
    [{ name: 'Ana', agree: 'yes' }, 'agree'],
    [{ name: 'Ana', dob: '2023-02-30' }, 'dob'],
    [{ name: 'Ana', phone: 'abc' }, 'phone'],
    [{ name: 'An\u0000a' }, 'name'],
    [{ name: { $ne: 1 } }, 'name'],
  ])('rejects invalid value %j', (data, field) => {
    expect(validateSubmission(schema, data).map((i) => i.field)).toContain(field);
  });
  it('rejects non-object data', () => {
    expect(validateSubmission(schema, [])).toHaveLength(1);
    expect(validateSubmission(schema, null)).toHaveLength(1);
  });
});

describe('field rules', () => {
  it('requires options for select and forbids them elsewhere', () => {
    expect(checkFieldRules({ type: 'select' })).toMatch(/require options/);
    expect(checkFieldRules({ type: 'text', options: ['a'] })).toMatch(/only allowed/);
    expect(checkFieldRules({ type: 'select', options: ['a'] })).toBeNull();
  });
  it('rejects inverted ranges', () => {
    expect(checkFieldRules({ type: 'text', validation: { minLength: 5, maxLength: 2 } })).toBeTruthy();
    expect(checkFieldRules({ type: 'number', validation: { min: 5, max: 2 } })).toBeTruthy();
  });
});

describe('slugify / permissions', () => {
  it('slugifies names', () => {
    expect(slugify('  Contact Us!! ')).toBe('contact-us');
    expect(slugify('***')).toBe('form');
  });
  it('maps roles to permissions', () => {
    expect(hasPermission(['form_viewer'], 'form:read')).toBe(true);
    expect(hasPermission(['form_viewer'], 'form:write')).toBe(false);
    expect(hasPermission(['form_editor'], 'form:publish')).toBe(false);
    expect(hasPermission(['form_admin'], 'form:delete')).toBe(true);
    expect(hasPermission(['unknown'], 'form:read')).toBe(false);
  });
});
