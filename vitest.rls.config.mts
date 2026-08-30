import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * RLS suite: runs against a real Supabase project, so it is kept out of the
 * default `npm test` run. Sequential and single-threaded, because the tests
 * share a database and create real users.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
  },
});
