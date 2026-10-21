'use strict';

const { z } = require('zod');

const idParam = z.string().regex(/^[1-9]\d{0,17}$/, 'Must be a numeric id');
const paramsWithId = z.object({ id: idParam });

const name = z.string().trim().min(1).max(150);
const slug = z
  .string()
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only');
const description = z.string().max(2000).nullable();
const configObject = z.record(z.string(), z.unknown());
const expectedVersion = z.number().int().min(1).max(2147483647);

// Unknown fields (e.g. createdBy, workspaceId, status) are rejected rather than trusted.
const createBody = z
  .object({ name, slug: slug.optional(), description: description.optional(), config: configObject.optional() })
  .strict();

const updateBody = z
  .object({
    expectedVersion: expectedVersion.optional(),
    name: name.optional(),
    description: description.optional(),
    // JSON-merge-patch: objects merge recursively, arrays/scalars replace, null removes a key.
    config: configObject.optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.description !== undefined || b.config !== undefined, {
    message: 'Provide at least one of name, description, config',
  });

const versionOnlyBody = z.object({ expectedVersion: expectedVersion.optional() }).strict();

const duplicateBody = z.object({ name: name.optional() }).strict();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

module.exports = { paramsWithId, createBody, updateBody, versionOnlyBody, duplicateBody, listQuery };
