import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    // Columns follow local time; the tests that care say which zone they mean.
    env: { TZ: 'UTC' },
  },
});
