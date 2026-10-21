'use strict';
const MAX_BIGINT = 9223372036854775807n;

/** Positive BIGINT-compatible decimal string, or null. */
function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) return null;
  return BigInt(value) <= MAX_BIGINT ? value : null;
}

module.exports = { parseId };
