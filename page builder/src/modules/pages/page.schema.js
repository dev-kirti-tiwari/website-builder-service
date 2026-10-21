const { z } = require('zod');
const { idSchema } = require('../../validators/common');

const name = z.string().trim().min(1, 'Name is required').max(180);
const slug = z.string().trim().toLowerCase().min(1).max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');
const status = z.enum(['DRAFT', 'PUBLISHED']);

const params = z.object({ id: idSchema });

const createBody = z.object({ name, slug }).strict();

const patchBody = z.object({ name: name.optional(), slug: slug.optional(), status: status.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.slug !== undefined || b.status !== undefined, 'Provide at least one field');

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: status.optional(),
  sort: z.enum(['created_at', 'updated_at', 'name']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const getQuery = z.object({ include: z.enum(['structure']).optional() });

module.exports = { params, createBody, patchBody, listQuery, getQuery };
