import { defineConfig } from 'vitest/config';

// Coverage feeds `fallow health --coverage` through .fallowrc.json so CRAP scores
// are computed from executed lines instead of export-reference estimates.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'scripts/lib/**/*.cjs', 'scripts/lib/**/*.mjs'],
    },
  },
});
