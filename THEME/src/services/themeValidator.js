'use strict';

const {
  themeConfigSchema,
  ANY_REF,
  COLOR_REF,
  DIM_REF,
  isColorLiteral,
  dimensionToPx,
} = require('../schemas/themeConfig');

const MAX_REF_DEPTH = 10;

// Paths that must exist before a theme can be activated.
const REQUIRED_FOR_ACTIVATION = [
  'colors.primary', 'colors.secondary', 'colors.background', 'colors.surface',
  'colors.heading', 'colors.body', 'colors.muted', 'colors.border',
  'typography.headingFontFamily', 'typography.bodyFontFamily',
  'typography.h1.fontSize', 'typography.h2.fontSize', 'typography.h3.fontSize',
  'typography.body.fontSize', 'typography.small.fontSize', 'typography.button.fontSize',
  'spacing.sm', 'spacing.md', 'spacing.lg',
  'radius.sm', 'radius.md', 'radius.lg',
  'buttons.primary',
  'layout.containerWidth',
];

function pathToString(path) {
  return path.reduce((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '');
}

/** Convert Zod issues into [{ path, code, message }] with the unknown key appended to the path. */
function formatZodIssues(error, prefix = []) {
  const out = [];
  for (const issue of error.issues) {
    const base = [...prefix, ...issue.path];
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({ path: pathToString([...base, key]), code: 'UNKNOWN_KEY', message: 'Unknown or unsupported key' });
      }
    } else {
      out.push({
        path: pathToString(base),
        code: issue.params?.code || (issue.code === 'invalid_type' ? 'INVALID_TYPE' : 'INVALID_VALUE'),
        message: issue.message,
      });
    }
  }
  return out;
}

function getPath(obj, dotted) {
  let cur = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Collect every string leaf in the config that looks like a {token.reference}. */
function collectRefs(node, path, out) {
  if (typeof node === 'string') {
    if (ANY_REF.test(node)) out.push({ path: pathToString(path), ref: node });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => collectRefs(v, [...path, i], out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectRefs(v, [...path, k], out);
  }
}

/** Follow a reference chain to its literal. Returns { value } or { error }. */
function resolveRef(config, ref) {
  const seen = new Set();
  let cur = ref;
  for (let depth = 0; depth < MAX_REF_DEPTH; depth += 1) {
    if (seen.has(cur)) return { error: 'REF_CYCLE', message: `Circular token reference: ${[...seen, cur].join(' -> ')}` };
    seen.add(cur);
    if (!COLOR_REF.test(cur) && !DIM_REF.test(cur)) {
      return { error: 'REF_INVALID', message: `Unsupported token reference ${cur}` };
    }
    const target = getPath(config, cur.slice(1, -1));
    if (typeof target !== 'string') {
      return { error: 'REF_MISSING', message: `Token reference ${cur} does not resolve to a value` };
    }
    if (!ANY_REF.test(target)) return { value: target };
    cur = target;
  }
  return { error: 'REF_TOO_DEEP', message: `Token reference chain longer than ${MAX_REF_DEPTH}` };
}

function parseHex(color) {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Resolve a color value (literal or reference) to a hex triple, or null if it can't be determined. */
function colorToRgb(config, value) {
  if (typeof value !== 'string') return null;
  let literal = value;
  if (ANY_REF.test(value)) {
    const r = resolveRef(config, value);
    if (r.error) return null;
    literal = r.value;
  }
  return isColorLiteral(literal) ? parseHex(literal) : null;
}

function contrastWarnings(config) {
  const warnings = [];
  const check = (label, fgPath, bgPath) => {
    const fg = colorToRgb(config, getPath(config, fgPath));
    const bg = colorToRgb(config, getPath(config, bgPath));
    if (fg && bg) {
      const ratio = contrastRatio(fg, bg);
      if (ratio < 4.5) {
        warnings.push({
          path: fgPath,
          code: 'LOW_CONTRAST',
          message: `${label} contrast ratio is ${ratio.toFixed(2)}:1 (WCAG AA recommends at least 4.5:1)`,
        });
      }
    }
  };
  check('Heading on background', 'colors.heading', 'colors.background');
  check('Body text on background', 'colors.body', 'colors.background');
  for (const v of ['primary', 'secondary']) {
    check(`${v} button text on button background`, `buttons.${v}.textColor`, `buttons.${v}.background`);
  }
  return warnings;
}

function gradientErrors(config) {
  const errors = [];
  for (const slot of ['page', 'section']) {
    const bg = config.backgrounds?.[slot];
    if (bg?.type === 'gradient' && Array.isArray(bg.stops)) {
      for (let i = 1; i < bg.stops.length; i += 1) {
        if (!(bg.stops[i].position >= bg.stops[i - 1].position)) {
          errors.push({
            path: `backgrounds.${slot}.stops[${i}].position`,
            code: 'GRADIENT_STOPS_UNORDERED',
            message: 'Gradient stop positions must be in non-decreasing order',
          });
        }
      }
    }
  }
  return errors;
}

/**
 * Validate a theme configuration.
 *   1. Strict schema validation (keys, types, units, ranges)
 *   2. Semantic validation (token references resolve, no cycles, gradient stop order)
 *   3. Completeness (only when `activation` is true)
 * Returns { errors, warnings }; the theme is valid when errors is empty.
 */
function validateThemeConfig(config, { activation = false } = {}) {
  const errors = [];
  const parsed = themeConfigSchema.safeParse(config);
  if (!parsed.success) errors.push(...formatZodIssues(parsed.error));

  if (config && typeof config === 'object') {
    const refs = [];
    collectRefs(config, [], refs);
    const seen = new Set(errors.map((e) => `${e.path}|${e.code}`));
    for (const { path, ref } of refs) {
      const r = resolveRef(config, ref);
      if (r.error && !seen.has(`${path}|${r.error}`)) {
        errors.push({ path, code: r.error, message: r.message });
      }
    }
    errors.push(...gradientErrors(config));

    if (activation) {
      for (const p of REQUIRED_FOR_ACTIVATION) {
        if (getPath(config, p) === undefined) {
          errors.push({ path: p, code: 'REQUIRED_FOR_ACTIVATION', message: 'Required before a theme can be activated' });
        }
      }
    }
  }

  const warnings = errors.length === 0 ? contrastWarnings(config) : [];
  return { errors, warnings };
}

module.exports = {
  validateThemeConfig,
  formatZodIssues,
  pathToString,
  resolveRef,
  contrastRatio,
  REQUIRED_FOR_ACTIVATION,
  dimensionToPx,
};
