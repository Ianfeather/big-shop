/** @type {import('next').NextConfig} */
const nextConfig = {
  // Already true before Faro arrived, and now load-bearing rather than merely
  // nice: scripts/upload-sourcemaps.sh has nothing to upload without it, and a
  // stack trace in Grafana stays a column of minified chunk names.
  productionBrowserSourceMaps: true,
  reactStrictMode: true,

  // Bridges two build-time values into the client bundle.
  //
  // Netlify sets COMMIT_REF and CONTEXT for the build, but Next only inlines
  // variables already named NEXT_PUBLIC_*, so without this the browser has no
  // way to say which build it is or which environment it belongs to - and every
  // Faro error would arrive labelled `dev` / `development`, indistinguishable
  // from a laptop's.
  //
  // Resolved here rather than in lib/telemetry/faro.ts because this file runs at
  // build time on the server, where the unprefixed variables actually exist.
  // The same precedence as the Go and Netlify runtimes: an explicit override
  // first, then the platform's own value, then a local default.
  env: {
    NEXT_PUBLIC_SERVICE_VERSION:
      process.env.SERVICE_VERSION || process.env.COMMIT_REF || 'dev',
    NEXT_PUBLIC_DEPLOY_ENV:
      process.env.DEPLOY_ENV || process.env.CONTEXT || 'development',
  }
};

module.exports = nextConfig;
