'use strict';
const { z, text, mediaRef, button } = require('./common');

module.exports = z.object({
  heading: text(160),
  subheading: text(240).optional(),
  description: text(2000).optional(),
  mediaId: mediaRef.optional(),
  primaryButton: button.optional(),
  secondaryButton: button.optional(),
}).strict();
