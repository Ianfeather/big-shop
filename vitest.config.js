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
    //
    // .next/ isn't excluded by configDefaults, and used to matter a great deal:
    // `next build`'s output tree contained a compiled copy of every
    // pages/api/**/*.test.js, because Next treats any file under pages/api as a
    // route. Running `test` after a `build` picked those copies up and executed
    // them outside Vitest's mocking setup, hitting the real OpenAI client.
    //
    // That no longer happens - the API route tests are now named *.test.mts,
    // which is outside Next's pageExtensions, so they are not routes and are
    // not compiled (see CLAUDE.md). The exclude stays because scanning build
    // output for tests is never right, not because the old failure could
    // return: a test file added back under a page extension now fails
    // `next build` outright, so no compiled copy would reach .next/ at all.
    exclude: [...configDefaults.exclude, 'e2e/**', '.next/**']
  }
});
