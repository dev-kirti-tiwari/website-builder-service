'use strict';
const { z, text, itemKey, items } = require('./common');

module.exports = z.object({
  heading: text(160),
  items: items(z.object({
    itemKey,
    question: text(300),
    answer: text(3000),
  }).strict(), 50),
}).strict();
