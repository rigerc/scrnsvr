import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// Coverage feeds `fallow health --coverage` through .fallowrc.json so CRAP scores
// are computed from executed lines instead of export-reference estimates.
export default defineConfig({
  // Match the production esbuild text loader when runtime imports GLSL sources.
  plugins: [{
    name: 'glsl-text',
    load(id) {
      const file = id.split('?')[0];
      if (file.endsWith('.glsl')) return `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`;
    },
  }],
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
