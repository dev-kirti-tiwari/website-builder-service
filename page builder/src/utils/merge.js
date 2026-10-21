const { AppError } = require('./errors');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function guard(key) {
  if (FORBIDDEN_KEYS.has(key)) {
    throw new AppError(422, 'VALIDATION_ERROR', `Key "${key}" is not allowed.`);
  }
}

// Shallow merge; a null value removes the key.
function mergeObject(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    guard(k);
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

// Merge per-device override objects; a null device removes that device.
function mergeResponsive(base, patch) {
  const out = { ...base };
  for (const [device, v] of Object.entries(patch || {})) {
    guard(device);
    if (v === null) delete out[device];
    else out[device] = mergeObject(out[device] || {}, v);
  }
  return out;
}

module.exports = { mergeObject, mergeResponsive };
