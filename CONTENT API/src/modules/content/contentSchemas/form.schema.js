'use strict';
// Section copy only. Form fields and submissions belong to the Form Service.
const { z, text } = require('./common');

module.exports = z.object({
  heading: text(160),
  description: text(1000).optional(),
  helperText: text(500).optional(),
}).strict();
