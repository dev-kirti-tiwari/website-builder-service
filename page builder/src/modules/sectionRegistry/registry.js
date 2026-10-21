const { z } = require('zod');
const { COMMON, columns, objectOf, responsiveOf } = require('../../validators/designTokens');
const { AppError } = require('../../utils/errors');

// Page Builder owns structure only. Text, prices, FAQ answers, etc. live in the Content API.
const DEFINITIONS = {
  hero: {
    label: 'Hero',
    variants: ['full-width', 'split-left', 'split-right'],
    keys: [...COMMON, 'minHeight', 'mediaPosition'],
    defaults: { variant: 'full-width', configuration: { alignment: 'center', minHeight: '480px' }, responsive: { mobile: { minHeight: '320px' } } },
  },
  features: {
    label: 'Features',
    variants: ['card-grid', 'grid', 'list'],
    keys: [...COMMON, 'columns', 'gap', 'iconPosition'],
    overrides: { columns: columns(1, 6) },
    defaults: { variant: 'card-grid', configuration: { columns: 3, gap: '24px' }, responsive: { tablet: { columns: 2 }, mobile: { columns: 1 } } },
  },
  images: {
    label: 'Images',
    variants: ['gallery', 'grid'],
    keys: [...COMMON, 'columns', 'gap', 'imageRatio', 'mediaPosition'],
    overrides: { columns: columns(1, 6) },
    defaults: { variant: 'grid', configuration: { columns: 3, gap: '16px', imageRatio: '4:3' }, responsive: { mobile: { columns: 1 } } },
  },
  testimonials: {
    label: 'Testimonials',
    variants: ['grid', 'carousel'],
    keys: [...COMMON, 'columns', 'gap', 'cardLayout'],
    overrides: { columns: columns(1, 4) },
    defaults: { variant: 'grid', configuration: { columns: 3, gap: '24px' }, responsive: { mobile: { columns: 1 } } },
  },
  pricing: {
    label: 'Pricing',
    variants: ['cards', 'compact'],
    keys: [...COMMON, 'columns', 'gap', 'highlightedCard', 'cardLayout'],
    overrides: { columns: columns(1, 4) },
    defaults: { variant: 'cards', configuration: { columns: 3, gap: '24px' }, responsive: { mobile: { columns: 1 } } },
  },
  faq: {
    label: 'FAQ',
    variants: ['accordion', 'grid'],
    keys: [...COMMON, 'columns', 'gap', 'defaultExpanded'],
    overrides: { columns: columns(1, 3) },
    defaults: { variant: 'accordion', configuration: { defaultExpanded: false }, responsive: {} },
  },
  cta: {
    label: 'CTA',
    variants: ['full-width', 'split-left', 'split-right'],
    keys: [...COMMON, 'minHeight', 'mediaPosition'],
    defaults: { variant: 'full-width', configuration: { alignment: 'center' }, responsive: {} },
  },
  form: {
    label: 'Form',
    variants: ['contained', 'full-width', 'split'],
    keys: [...COMMON, 'displayLayout'],
    defaults: { variant: 'contained', configuration: { containerWidth: '640px', alignment: 'center' }, responsive: {} },
  },
};

const REGISTRY = {};
for (const [type, def] of Object.entries(DEFINITIONS)) {
  const configuration = objectOf(def.keys, def.overrides);
  const device = objectOf(def.keys, def.overrides, { visible: z.boolean().optional() });
  REGISTRY[type] = {
    type,
    label: def.label,
    variants: def.variants,
    capabilities: [...new Set([...def.keys.map((k) => k), 'responsive', 'visibility'])],
    defaults: def.defaults,
    configurationSchema: configuration,
    responsiveSchema: responsiveOf(device),
  };
}

const TYPES = Object.keys(REGISTRY);

const toDetails = (location, error) =>
  error.issues.map((i) => ({ location, path: i.path.join('.'), message: i.message }));

function get(type) {
  return REGISTRY[type] || null;
}

function list() {
  return TYPES.map((type) => {
    const { label, variants, capabilities, defaults } = REGISTRY[type];
    return { type, label, variants, capabilities, defaults };
  });
}

// Validates a section's structural data; throws 422 SECTION_CONFIG_INVALID. Returns normalized values.
function validate(type, { variant, configuration, responsive }) {
  const entry = get(type);
  if (!entry) throw new AppError(422, 'SECTION_CONFIG_INVALID', `Unsupported section type "${type}".`);
  const details = [];
  if (!variant || !entry.variants.includes(variant)) {
    details.push({ location: 'body', path: 'variant', message: `Allowed variants: ${entry.variants.join(', ')}` });
  }
  const cfg = entry.configurationSchema.safeParse(configuration || {});
  if (!cfg.success) details.push(...toDetails('configuration', cfg.error));
  const rsp = entry.responsiveSchema.safeParse(responsive || {});
  if (!rsp.success) details.push(...toDetails('responsive', rsp.error));
  if (details.length) throw new AppError(422, 'SECTION_CONFIG_INVALID', 'Section configuration is invalid.', details);
  return { variant, configuration: cfg.data, responsive: rsp.data };
}

module.exports = { TYPES, get, list, validate };
