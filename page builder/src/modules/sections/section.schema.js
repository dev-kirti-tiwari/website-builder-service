const { z } = require('zod');
const { TYPES } = require('../sectionRegistry/registry');
const { idSchema, expectedRevision, jsonObject, contentRef } = require('../../validators/common');

// Deep validation of configuration/responsive happens in the registry (strict, per type).
const configuration = jsonObject;
const responsive = z.record(z.string(), jsonObject.nullable());
const variant = z.string().min(1).max(60);

const params = z.object({ id: idSchema });
const sectionParams = z.object({ id: idSchema, sectionId: idSchema });

const createBody = z.object({
  type: z.enum(TYPES),
  variant: variant.optional(),
  position: z.number().int().min(1).max(10000).optional(),
  configuration: configuration.optional(),
  responsive: responsive.optional(),
  visible: z.boolean().optional(),
  contentRef: contentRef.optional(),
  expectedRevision,
}).strict();

const patchFields = {
  variant: variant.optional(),
  visible: z.boolean().optional(),
  configuration: configuration.optional(),
  responsive: responsive.optional(),
  contentRef: contentRef.optional(),
};

const patchBody = z.object({ ...patchFields, expectedRevision }).strict()
  .refine((b) => Object.keys(patchFields).some((k) => b[k] !== undefined), 'Provide at least one field to update');

const reorderBody = z.object({
  sectionIds: z.array(idSchema).min(1).max(500),
  expectedRevision,
}).strict();

const optionalRevisionBody = z.object({ expectedRevision }).strict();

module.exports = { params, sectionParams, createBody, patchBody, patchFields, reorderBody, optionalRevisionBody };
