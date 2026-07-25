// Fails fast with a clear error at the point an env var is needed, rather
// than letting a `process.env.X!` assertion pass `undefined` through and
// fail unhelpfully deep inside whatever consumes it.
export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
