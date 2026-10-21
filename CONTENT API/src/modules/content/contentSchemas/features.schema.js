'use strict';
const { z, text, mediaRef, itemKey, items } = require('./common');

module.exports = z.object({
  heading: text(160),
  description: text(2000).optional(),
  items: items(z.object({
    itemKey,
    title: text(120),
    description: text(1000).optional(),
    iconMediaId: mediaRef.optional(),
  }).strict(), 24),
}).strict();
