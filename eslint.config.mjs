import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';

// Replaces the old .eslintrc.json. Same effective ruleset as before:
// next/core-web-vitals plus eslint-config-prettier to switch off the
// formatting rules Prettier owns.
//
// The old config also declared `plugins: ["react"]` and turned off
// `react/react-in-jsx-scope`. Both are dropped rather than ported:
// core-web-vitals already loads the React plugin and already disables that
// rule, and re-declaring a plugin an extended config has loaded is an error in
// flat config, not a harmless duplicate.
const config = [
  // `next lint` scoped itself to source directories implicitly. `eslint .`
  // does not, so build output and generated trees have to be named here.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  ...nextCoreWebVitals,
  prettier,
  {
    // e2e/ is a separate project with its own tsconfig, and `next lint` never
    // covered it. Linting it is worth doing, but the React Hooks rules cannot
    // apply there - it contains no components - and one of them actively
    // misfires: a Playwright fixture is written
    // `async ({ page }, use) => await use(...)`, which react-hooks reads as
    // calling a hook named `use` (React 19's) inside a non-component function
    // named `page`. So the React rules are off here and the general
    // JavaScript/TypeScript rules stay on. See follow-ups.md #33.
    files: ['e2e/**'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  }
];

export default config;
