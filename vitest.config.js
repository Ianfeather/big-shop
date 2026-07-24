import { defineConfig, configDefaults } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
import path from 'path';

// Components/hooks/tests in this repo write JSX in plain .js files. Vite's
// built-in esbuild plugin only treats .jsx/.tsx as JSX by extension, and
// @vitejs/plugin-react's babel pass silently no-ops on plain .js files with
// no other babel plugins configured — so neither picks up JSX in .js on its
// own. This plugin forces every non-node_modules .js file through esbuild's
// JSX transform directly.
function jsxInJs() {
  return {
    name: 'jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.js') || id.includes('node_modules')) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    }
  };
}

export default defineConfig({
  // .tsx files are handled natively by esbuild (no plugin needed, unlike the
  // .js case above) — this just makes sure it uses the automatic runtime too,
  // consistent with jsxInJs, instead of esbuild's classic-transform default.
  esbuild: {
    jsx: 'automatic'
  },
  plugins: [jsxInJs()],
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
