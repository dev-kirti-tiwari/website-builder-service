const { z } = require('zod');

const size = (max) =>
  z.string()
    .regex(/^\d{1,4}(\.\d{1,2})?(px|rem|%)$/, 'Use a number with px, rem or % (e.g. "24px")')
    .refine((v) => parseFloat(v) <= max, `Must be <= ${max}`);

const color = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Use a hex color');
const token = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Use a lowercase design token');

// Backgrounds use colors, named presets or media references only (no raw CSS).
const background = z.object({
  type: z.enum(['none', 'color', 'gradient', 'media']),
  color: color.optional(),
  preset: token.optional(),
  mediaRef: z.string().regex(/^[A-Za-z0-9_:.-]{1,64}$/).optional(),
}).strict();

const columns = (min, max) => z.number().int().min(min).max(max);

const SHAPE = {
  containerWidth: size(2400),
  maxWidth: size(2400),
  minHeight: size(2000),
  gap: size(200),
  padding: size(400),
  paddingTop: size(400),
  paddingBottom: size(400),
  paddingLeft: size(400),
  paddingRight: size(400),
  marginTop: size(400),
  marginBottom: size(400),
  alignment: z.enum(['left', 'center', 'right']),
  verticalAlignment: z.enum(['top', 'center', 'bottom']),
  background,
  border: z.enum(['none', 'thin', 'medium', 'thick']),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'full']),
  shadow: z.enum(['none', 'sm', 'md', 'lg']),
  mediaPosition: z.enum(['left', 'right', 'top', 'bottom']),
  iconPosition: z.enum(['top', 'left']),
  imageRatio: z.enum(['1:1', '4:3', '3:2', '16:9']),
  cardLayout: z.enum(['stacked', 'horizontal']),
  displayLayout: z.enum(['stacked', 'inline']),
  highlightedCard: z.number().int().min(1).max(12),
  defaultExpanded: z.boolean(),
};

const COMMON = [
  'containerWidth', 'maxWidth', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'marginTop', 'marginBottom', 'alignment', 'verticalAlignment', 'background', 'border', 'radius', 'shadow',
];

// Strict object limited to `keys`; unknown properties are rejected.
function objectOf(keys, overrides = {}, extra = {}) {
  const shape = {};
  for (const key of keys) shape[key] = (overrides[key] || SHAPE[key]).optional();
  return z.object({ ...shape, ...extra }).strict();
}

function responsiveOf(device) {
  return z.object({
    desktop: device.optional(),
    tablet: device.optional(),
    mobile: device.optional(),
  }).strict();
}

module.exports = { SHAPE, COMMON, columns, objectOf, responsiveOf };
