import { z } from 'zod';
import { AppError } from '../errors';

const ID_RE = /^[1-9]\d{0,17}$/;

export function parseId(value: unknown, name = 'id'): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new AppError(400, 'INVALID_ID', `${name} must be a positive integer`);
  }
  return value;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw r.error;
  return r.data;
}
