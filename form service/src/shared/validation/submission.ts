export type FieldType = 'text' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'phone';

export interface SchemaField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[] | null;
  validation?: { minLength?: number; maxLength?: number; min?: number; max?: number };
}

export interface PublishedSchema {
  fields: SchemaField[];
}

export interface FieldIssue {
  field: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{6,25}$/;
// control chars (incl. NUL, which PostgreSQL jsonb rejects) except tab/newline/CR
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DEFAULT_MAX_LEN: Record<string, number> = { text: 1000, textarea: 5000, email: 254, phone: 25 };

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

/** Validates visitor data against a published schema. Rejects unknown fields. */
export function validateSubmission(schema: PublishedSchema, data: unknown): FieldIssue[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return [{ field: 'data', message: 'must be an object' }];
  }
  const issues: FieldIssue[] = [];
  const values = data as Record<string, unknown>;
  const known = new Set(schema.fields.map((f) => f.name));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) issues.push({ field: key, message: 'unknown field' });
  }

  for (const f of schema.fields) {
    const v = values[f.name];
    if (isEmpty(v)) {
      if (f.required) issues.push({ field: f.name, message: 'is required' });
      continue;
    }
    const msg = checkValue(f, v);
    if (msg) issues.push({ field: f.name, message: msg });
  }
  return issues;
}

function checkValue(f: SchemaField, v: unknown): string | null {
  const rules = f.validation ?? {};
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone': {
      if (typeof v !== 'string') return 'must be a string';
      if (CONTROL_RE.test(v)) return 'contains disallowed characters';
      const max = Math.min(rules.maxLength ?? Infinity, DEFAULT_MAX_LEN[f.type]);
      if (v.length > max) return `must be at most ${max} characters`;
      if (rules.minLength !== undefined && v.length < rules.minLength) {
        return `must be at least ${rules.minLength} characters`;
      }
      if (f.type === 'email' && !EMAIL_RE.test(v)) return 'must be a valid email';
      if (f.type === 'phone' && !PHONE_RE.test(v)) return 'must be a valid phone number';
      return null;
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
      if (rules.min !== undefined && v < rules.min) return `must be >= ${rules.min}`;
      if (rules.max !== undefined && v > rules.max) return `must be <= ${rules.max}`;
      return null;
    case 'select':
      if (typeof v !== 'string' || !(f.options ?? []).includes(v)) return 'must be one of the allowed options';
      return null;
    case 'checkbox':
      return typeof v === 'boolean' ? null : 'must be a boolean';
    case 'date': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'must be a date (YYYY-MM-DD)';
      const d = new Date(`${v}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? 'must be a valid date' : null;
    }
    default:
      return 'unsupported field type';
  }
}
