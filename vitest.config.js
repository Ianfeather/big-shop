import { defineConfig } from 'vitest/config';
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
    css: true
  }
});
