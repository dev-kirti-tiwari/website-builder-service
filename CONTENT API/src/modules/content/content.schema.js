'use strict';
const { z } = require('zod');
const sectionSchemas = require('./contentSchemas');
const { E } = require('../../utils/errors');
const { parseId } = require('../../utils/ids');

const SECTION_TYPES = Object.keys(sectionSchemas);
const SUPPORTED_SCHEMA_VERSIONS = [1];

const idString = z.string().refine((v) => parseId(v) !== null, 'must be a positive integer id string');
const revision = z.number().int().min(1).max(2147483647);
const contentObject = z.record(z.unknown()).refine((v) => !Array.isArray(v), 'content must be an object');

const createBody = z.object({
  pageId: idString,
  sectionType: z.string().min(1).max(40),
  schemaVersion: z.number().int().refine((v) => SUPPORTED_SCHEMA_VERSIONS.includes(v), 'unsupported schemaVersion').optional(),
  content: contentObject,
}).strict();

const replaceBody = z.object({ expectedRevision: revision, content: contentObject }).strict();
const patchBody = z.object({ expectedRevision: revision, content: contentObject }).strict();
const restoreBody = z.object({ expectedRevision: revision }).strict();

const duplicateBody = z.object({
  mappings: z.array(z.object({
    sourceSectionId: idString,
    targetSectionId: idString,
    targetPageId: idString.optional(),
  }).strict()).min(1).max(100),
}).strict();

const formatIssues = (issues) =>
  issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** Parse a request-level payload; failures are 400 BAD_REQUEST. */
function parseRequest(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw E.badRequest('Request validation failed', formatIssues(r.error.issues));
  return r.data;
}

/** Validate a content document against its section schema; failures are 422. */
function validateContent(sectionType, content) {
  const schema = sectionSchemas[sectionType];
  if (!schema) throw E.sectionTypeMismatch(`Unsupported section type: ${sectionType}`);
  const r = schema.safeParse(content);
  if (r.success) return r.data;
  const details = formatIssues(r.error.issues);
  const link = r.error.issues.filter((i) => i.params?.apiCode === 'INVALID_LINK');
  const media = r.error.issues.filter((i) => i.params?.apiCode === 'INVALID_MEDIA_REFERENCE');
  if (link.length) throw E.invalidLink(formatIssues(link));
  if (media.length) throw E.invalidMedia(formatIssues(media));
  throw E.schemaInvalid(details);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * PATCH semantics (RFC 7396 JSON Merge Patch): objects merge recursively, arrays and scalars
 * are replaced wholesale, `null` removes a key.
 */
function mergePatch(target, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

module.exports = {
  SECTION_TYPES, createBody, replaceBody, patchBody, restoreBody, duplicateBody,
  parseRequest, validateContent, mergePatch, idString,
};
