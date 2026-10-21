const { z } = require('zod');
const { COMMON, columns, objectOf, responsiveOf } = require('../../validators/designTokens');
const { jsonObject, expectedRevision } = require('../../validators/common');

const LAYOUT_KEYS = [...COMMON, 'minHeight', 'gap'];
const overrides = { columns: columns(1, 12) };

const layoutSchema = objectOf([...LAYOUT_KEYS, 'columns'], overrides, {
  variant: z.enum(['full', 'split', 'contained']).optional(),
});
const responsiveSchema = responsiveOf(objectOf([...LAYOUT_KEYS, 'columns'], overrides, { visible: z.boolean().optional() }));

const patchBody = z.object({
  layout: jsonObject.optional(),
  responsive: z.record(z.string(), jsonObject.nullable()).optional(),
  expectedRevision,
}).strict().refine((b) => b.layout || b.responsive, 'Provide layout and/or responsive');

module.exports = { layoutSchema, responsiveSchema, patchBody };
