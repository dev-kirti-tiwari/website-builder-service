'use strict';
// Runs the Postman collection with newman against a running API (default http://localhost:4080).
const newman = require('newman');
const { buildEnvironment, buildCollection } = require('./build-postman');
const { localTokens } = require('./lib/tokens');

const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4080}`;
const environment = buildEnvironment({
  ...localTokens(),
  baseUrl,
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || '',
});

newman.run(
  {
    collection: buildCollection(),
    environment,
    reporters: 'cli',
  },
  (err, summary) => {
    if (err) {
      console.error(err);
      process.exit(2);
    }
    process.exit(summary.run.failures.length ? 1 : 0);
  },
);
