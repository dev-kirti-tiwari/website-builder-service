import { z } from 'zod';

export const FIELD_TYPES = ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'date', 'phone'] as const;

const validationSchema = z
  .object({
    minLength: z.number().int().min(0).max(10000),
    maxLength: z.number().int().min(1).max(10000),
    min: z.number().finite(),
    max: z.number().finite(),
  })
  .partial()
  .strict();

const base = {
  label: z.string().trim().min(1).max(200),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(200)).min(1).max(100).nullish(),
  validation: validationSchema.optional(),
  position: z.number().int().min(0).max(10000).optional(),
};

export const fieldCreateSchema = z
  .object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'must be snake_case, start with a letter'), ...base })
  .strict();

export const fieldUpdateSchema = z
  .object({
    label: base.label.optional(),
    type: base.type.optional(),
    required: z.boolean().optional(),
    options: base.options,
    validation: base.validation,
    position: base.position,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one property is required');

/** Cross-property rules shared by create and (merged) update. */
export function checkFieldRules(f: {
  type: string;
  options?: string[] | null;
  validation?: { minLength?: number; maxLength?: number; min?: number; max?: number };
}): string | null {
  if (f.type === 'select' && (!f.options || f.options.length === 0)) return 'select fields require options';
  if (f.type !== 'select' && f.options && f.options.length > 0) return 'options are only allowed on select fields';
  const v = f.validation ?? {};
  if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) {
    return 'minLength must be <= maxLength';
  }
  if (v.min !== undefined && v.max !== undefined && v.min > v.max) return 'min must be <= max';
  return null;
}
