'use strict';
const { z, text, button } = require('./common');

module.exports = z.object({
  heading: text(160),
  description: text(1000).optional(),
  primaryButton: button.optional(),
  secondaryButton: button.optional(),
}).strict();
