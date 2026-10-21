'use strict';

// Shared breakpoint + fallback contract. The frontend renderer MUST use the same values.
const BREAKPOINTS = Object.freeze({
  phone: Object.freeze({ minWidth: 0, maxWidth: 767 }),
  tablet: Object.freeze({ minWidth: 768, maxWidth: 1023 }),
  laptop: Object.freeze({ minWidth: 1024 }),
});

const DEVICES = Object.freeze(['phone', 'tablet', 'laptop']);

function deviceForWidth(width) {
  if (!Number.isFinite(width) || width < 0) throw new RangeError('width must be a non-negative number');
  if (width <= BREAKPOINTS.phone.maxWidth) return 'phone';
  if (width <= BREAKPOINTS.tablet.maxWidth) return 'tablet';
  return 'laptop';
}

/**
 * Resolve a responsive value for a device: device override, else base value.
 * Returns undefined when neither exists (caller must use a schema default or reject).
 */
function resolveResponsive(value, device) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return value;
  if (!DEVICES.includes(device)) throw new RangeError(`Unknown device "${device}"`);
  return value[device] !== undefined ? value[device] : value.base;
}

module.exports = { BREAKPOINTS, DEVICES, deviceForWidth, resolveResponsive };
