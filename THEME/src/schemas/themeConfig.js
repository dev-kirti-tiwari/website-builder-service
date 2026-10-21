'use strict';

/**
 * Strict, versioned schema for the visual theme configuration (JSONB `config`).
 *
 * - Every object is strict: unknown keys are rejected (no arbitrary JSON).
 * - Values are restricted to safe literals (hex/rgb/hsl colors, px/rem/em dimensions) or token
 *   references such as {colors.primary}. No raw CSS, HTML or JavaScript is representable.
 * - Sections and keys are optional so a DRAFT can be saved incrementally; completeness is
 *   enforced separately at activation time (see themeValidator.js).
 */

const { z } = require('zod');
const { BREAKPOINTS } = require('../responsive');

const SCHEMA_VERSION = 1;

// ---------- primitives ----------

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]{1,48}\)$/i;
const COLOR_REF = /^\{colors\.[a-zA-Z0-9]+\}$/;
const DIM_REF = /^\{(?:spacing|radius)\.[a-zA-Z0-9]+\}$/;
const DIMENSION = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/;
const ANY_REF = /^\{[^{}]*\}$/;

const isColorLiteral = (v) => v === 'transparent' || HEX_COLOR.test(v) || FUNC_COLOR.test(v);

/** Convert a dimension literal to px (rem/em assume a 16px root) or null if not a dimension. */
function dimensionToPx(v) {
  const m = DIMENSION.exec(v);
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'px' ? 1 : 16);
}

const colorValue = z.string().max(64).superRefine((v, ctx) => {
  if (!isColorLiteral(v) && !COLOR_REF.test(v)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Must be a hex/rgb(a)/hsl(a) color, "transparent", or a color token reference like {colors.primary}',
    });
  }
});

/** Dimension literal (px/rem/em) within [minPx, maxPx], optionally a {spacing.*}/{radius.*} reference. */
function dimension({ min = 0, max = 4096, allowRef = true } = {}) {
  return z.string().max(32).superRefine((v, ctx) => {
    if (allowRef && DIM_REF.test(v)) return;
    const px = dimensionToPx(v);
    if (px === null) {
      ctx.addIssue({ code: 'custom', message: 'Must be a number with unit px, rem or em (e.g. "16px")' });
    } else if (px < min || px > max) {
      ctx.addIssue({ code: 'custom', message: `Must be between ${min}px and ${max}px (rem/em counted as 16px)` });
    }
  });
}

/** Build a strict object whose every key is optional (draft-friendly). */
function partialStrict(shape) {
  return z
    .object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.optional()])))
    .strict();
}

/**
 * A value that is either a plain value or { base, phone, tablet, laptop } overrides.
 * Unknown device keys (e.g. "mobile") are rejected. Issues keep their nested paths, e.g.
 * typography.h1.fontSize.phone.
 */
function responsive(inner) {
  const overrides = z
    .object({ base: inner.optional(), phone: inner.optional(), tablet: inner.optional(), laptop: inner.optional() })
    .strict();
  return z.unknown().superRefine((val, ctx) => {
    if (val === undefined) return;
    const isObj = val !== null && typeof val === 'object' && !Array.isArray(val);
    const result = (isObj ? overrides : inner).safeParse(val);
    if (result.success) {
      if (isObj && Object.keys(val).length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Provide at least one of base, phone, tablet, laptop' });
      }
      return;
    }
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) {
          ctx.addIssue({
            code: 'custom',
            message: 'Unknown key (allowed: base, phone, tablet, laptop)',
            path: [...issue.path, key],
            params: { code: 'UNKNOWN_KEY' },
          });
        }
      } else {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
    }
  });
}

// ---------- sections ----------

const COLOR_KEYS = [
  'primary', 'secondary', 'accent', 'background', 'surface',
  'heading', 'body', 'muted', 'border', 'success', 'warning', 'danger',
];
const colors = partialStrict(Object.fromEntries(COLOR_KEYS.map((k) => [k, colorValue])));

const gradientStop = z
  .object({ color: colorValue, position: z.number().min(0).max(100) })
  .strict();

const background = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: colorValue }).strict(),
  z
    .object({
      type: z.literal('gradient'),
      angle: z.number().min(0).max(360),
      stops: z.array(gradientStop).min(2).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      // Reference to a Media-owned asset; Theme API never stores files.
      assetId: z.string().regex(/^[1-9]\d{0,17}$/, 'Must be a Media asset id (numeric string)'),
      fit: z.enum(['cover', 'contain', 'fill', 'none']).optional(),
      position: z
        .enum(['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])
        .optional(),
      overlayColor: colorValue.optional(),
    })
    .strict(),
]);
const backgrounds = partialStrict({ page: background, section: background });

const fontFamily = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ,\-_']{0,99}$/, 'Font family may only contain letters, digits, spaces, commas, hyphens, underscores');
const fontWeight = z
  .number()
  .int()
  .min(100)
  .max(900)
  .refine((n) => n % 100 === 0, 'Must be a multiple of 100 (100-900)');

const textRole = partialStrict({
  fontSize: responsive(dimension({ min: 8, max: 200, allowRef: false })),
  fontWeight,
  fontStyle: z.enum(['normal', 'italic']),
  lineHeight: z.number().min(0.8).max(3),
  letterSpacing: dimension({ min: -5, max: 20, allowRef: false }),
  color: colorValue,
});
const TEXT_ROLES = ['h1', 'h2', 'h3', 'body', 'small', 'button'];
const typography = partialStrict({
  headingFontFamily: fontFamily,
  bodyFontFamily: fontFamily,
  ...Object.fromEntries(TEXT_ROLES.map((r) => [r, textRole])),
});

const SPACING_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const spacing = partialStrict(
  Object.fromEntries(SPACING_KEYS.map((k) => [k, responsive(dimension({ min: 0, max: 512, allowRef: false }))])),
);

const RADIUS_KEYS = ['none', 'sm', 'md', 'lg', 'pill'];
const radius = partialStrict(
  Object.fromEntries(RADIUS_KEYS.map((k) => [k, dimension({ min: 0, max: 9999, allowRef: false })])),
);

const shadow = partialStrict({
  offsetX: dimension({ min: -100, max: 100, allowRef: false }),
  offsetY: dimension({ min: -100, max: 100, allowRef: false }),
  blur: dimension({ min: 0, max: 200, allowRef: false }),
  spread: dimension({ min: -100, max: 100, allowRef: false }),
  color: colorValue,
});
const shadows = partialStrict({ sm: shadow, md: shadow, lg: shadow });

const buttonVariant = partialStrict({
  background: colorValue,
  textColor: colorValue,
  borderColor: colorValue,
  borderWidth: dimension({ min: 0, max: 16 }),
  radius: dimension({ min: 0, max: 9999 }),
  paddingX: dimension({ min: 0, max: 128 }),
  paddingY: dimension({ min: 0, max: 128 }),
  fontWeight,
});
const buttons = partialStrict({ primary: buttonVariant, secondary: buttonVariant, outline: buttonVariant });

const layout = partialStrict({
  containerWidth: responsive(dimension({ min: 320, max: 2560, allowRef: false })),
  pagePadding: responsive(dimension({ min: 0, max: 256, allowRef: false })),
  sectionSpacing: responsive(dimension({ min: 0, max: 512, allowRef: false })),
  gridGap: responsive(dimension({ min: 0, max: 128, allowRef: false })),
});

// Breakpoints are a fixed platform contract; they may be echoed but never changed.
const breakpoints = z
  .object({
    phone: z.object({ maxWidth: z.literal(BREAKPOINTS.phone.maxWidth) }).strict(),
    tablet: z
      .object({ minWidth: z.literal(BREAKPOINTS.tablet.minWidth), maxWidth: z.literal(BREAKPOINTS.tablet.maxWidth) })
      .strict(),
    laptop: z.object({ minWidth: z.literal(BREAKPOINTS.laptop.minWidth) }).strict(),
  })
  .strict();
const responsiveSection = partialStrict({ breakpoints });

const themeConfigSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION).optional(),
    colors: colors.optional(),
    backgrounds: backgrounds.optional(),
    typography: typography.optional(),
    spacing: spacing.optional(),
    radius: radius.optional(),
    shadows: shadows.optional(),
    buttons: buttons.optional(),
    layout: layout.optional(),
    responsive: responsiveSection.optional(),
  })
  .strict();

module.exports = {
  SCHEMA_VERSION,
  themeConfigSchema,
  COLOR_KEYS,
  TEXT_ROLES,
  SPACING_KEYS,
  RADIUS_KEYS,
  ANY_REF,
  COLOR_REF,
  DIM_REF,
  isColorLiteral,
  dimensionToPx,
};
