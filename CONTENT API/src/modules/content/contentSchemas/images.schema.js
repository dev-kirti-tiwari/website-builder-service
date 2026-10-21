'use strict';
const { z, text, mediaRef, itemKey, items } = require('./common');

module.exports = z.object({
  heading: text(160).optional(),
  items: items(z.object({
    itemKey,
    mediaId: mediaRef,
    alt: text(250),
    title: text(120).optional(),
    caption: text(500).optional(),
  }).strict(), 50),
}).strict();
