import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // .tsx/.ts files are handled natively by esbuild. This just makes sure JSX
  // uses the automatic runtime instead of esbuild's classic-transform
  // default, which needs React in scope.
  esbuild: {
    jsx: 'automatic'
  },
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, 'components'),
      '@hooks': path.resolve(__dirname, 'hooks')
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
    css: true,
    // e2e/ holds Playwright specs (run via `npm run test:e2e`), not Vitest ones.
    // .next/ isn't excluded by configDefaults - `next build`'s output tree
    // contains a compiled copy of every pages/api/**/*.test.js (Next.js
    // treats any .js under pages/api as a route, so these ship as real,
    // if unused, serverless functions - a pre-existing quirk, not something
    // this exclude fixes). Without this, running `test` after a `build`
    // picks up those compiled copies too and actually executes them outside
    // Vitest's mocking setup, hitting the real OpenAI client and failing on
    // a missing API key.
    exclude: [...configDefaults.exclude, 'e2e/**', '.next/**']
  }
});
