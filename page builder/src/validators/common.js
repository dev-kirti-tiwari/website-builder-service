const { z } = require('zod');

const idSchema = z.string().regex(/^[1-9]\d{0,17}$/, 'Must be a numeric ID');
const revisionNumber = z.number().int().min(1).max(2147483647);
const expectedRevision = revisionNumber.optional();
const jsonObject = z.record(z.string(), z.unknown());
const contentRef = z.string().regex(/^[A-Za-z0-9_:.-]{1,120}$/, 'Invalid content reference').nullable();

module.exports = { idSchema, revisionNumber, expectedRevision, jsonObject, contentRef };
