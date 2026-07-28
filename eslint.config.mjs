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
  //
  // e2e/ is excluded because it is a separate project (its own tsconfig) that
  // `next lint` never covered, and Playwright's fixture API collides head-on
  // with the React Hooks rules: a fixture is written `async ({ page }, use) =>
  // await use(...)`, which react-hooks reads as calling a hook named `use`
  // inside a non-component function `page`. Bringing e2e/ under lint is a
  // reasonable thing to want, but it needs its own config block, and that is
  // not what this upgrade is for.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'e2e/**'
    ]
  },
  ...nextCoreWebVitals,
  prettier,
  {
    rules: {
      // Introduced in eslint-plugin-react-hooks v6; eslint-config-next@16
      // pulls in v7.1.1. It fires on 10 pre-existing, working call sites
      // (subscription hooks, toast state, the Recipe Import polling loop), so
      // it is off rather than smuggling a behavioural refactor of the repo's
      // hottest files into a version bump. Tracked as follow-ups.md #32.
      //
      // To be clear about what this does and does not preserve: react-hooks
      // v7 turns on roughly a dozen other rules the Next 14 config did not
      // have (`purity`, `immutability`, `refs`, `use-memo`,
      // `set-state-in-render` and friends). Those are *adopted*, not
      // suppressed - they simply pass as-is today. This rule is the only new
      // one with existing violations.
      'react-hooks/set-state-in-effect': 'off'
    }
  }
];

export default config;
