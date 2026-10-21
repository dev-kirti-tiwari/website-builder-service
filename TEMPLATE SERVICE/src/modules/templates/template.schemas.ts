import { z } from 'zod';
import { isBigIntId } from '../../lib/bigint';
import { SLUG_MAX, SLUG_PATTERN } from '../../lib/slug';

export const bigintId = z.string().refine(isBigIntId, 'must be a positive BIGINT decimal string (JSON string, not number)');

const tagName = z.string().trim().min(1).max(80);

export const createTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: z.string().trim().toLowerCase().min(1).max(SLUG_MAX).regex(SLUG_PATTERN, 'lowercase letters, digits and single hyphens only').optional(),
    description: z.string().max(5000).nullish(),
    categoryId: bigintId.nullish(),
    industry: z.string().trim().min(1).max(80).nullish(),
    visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).default('PUBLIC'),
    thumbnailAssetId: bigintId.nullish(),
    tags: z.array(tagName).max(20).default([]),
    // GLOBAL catalog entries need the explicit template:global:admin permission. Ownership IDs are never read from the body.
    scope: z.enum(['TENANT', 'GLOBAL']).default('TENANT'),
  })
  .strict();

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    slug: z.string().trim().toLowerCase().min(1).max(SLUG_MAX).regex(SLUG_PATTERN).optional(),
    description: z.string().max(5000).nullable().optional(),
    categoryId: bigintId.nullable().optional(),
    industry: z.string().trim().min(1).max(80).nullable().optional(),
    visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional(),
    thumbnailAssetId: bigintId.nullable().optional(),
    tags: z.array(tagName).max(20).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');

export const SORT_FIELDS = ['createdAt', 'updatedAt', 'name'] as const;

export const listTemplatesQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: bigintId.optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  industry: z.string().trim().min(1).max(80).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(SORT_FIELDS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
