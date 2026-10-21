import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:5432/form_api_test',
    },
  },
});
