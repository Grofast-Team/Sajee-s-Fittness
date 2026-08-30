import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The RLS suite needs a live Supabase project and real credentials, so it
    // is run separately via `npm run test:rls`. Keeping it out of the default
    // run means `npm test` stays fast, offline and deterministic.
    exclude: ['tests/rls/**'],
  },
});
