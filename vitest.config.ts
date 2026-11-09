import { defineConfig } from 'vitest/config';

// One test run for the whole workspace: `pnpm test` from the root.
export default defineConfig({
  test: {
    include: ['**/src/**/*.test.ts', '**/test/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
    // Git and Docker fixtures are slow on Windows and under parallel load; 5 s flaked in wave 4.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
