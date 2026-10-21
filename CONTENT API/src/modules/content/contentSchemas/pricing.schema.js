'use strict';
const { z, text, itemKey, items, button } = require('./common');

module.exports = z.object({
  heading: text(160),
  description: text(1000).optional(),
  plans: items(z.object({
    itemKey,
    name: text(80),
    displayPrice: text(40),
    currency: text(10).optional(),
    billingLabel: text(40).optional(),
    description: text(500).optional(),
    features: z.array(text(200)).max(30, 'at most 30 features').optional(),
    button: button.optional(),
  }).strict(), 6),
}).strict();
