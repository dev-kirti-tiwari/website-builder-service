'use strict';
const { z, text, mediaRef, itemKey, items } = require('./common');

module.exports = z.object({
  heading: text(160).optional(),
  items: items(z.object({
    itemKey,
    quote: text(1000),
    author: text(120),
    role: text(120).optional(),
    company: text(120).optional(),
    avatarMediaId: mediaRef.optional(),
  }).strict(), 24),
}).strict();
