// The two counters the spec's Phase 3 lists and correction 4 relocates here:
// import outcome, and LLM tokens. Both belong to this runtime because both
// measure something only this runtime can see - no Go file references OpenAI,
// and the Go API is never told which Import Source a save came from.
//
// **Every label set here is closed, and that is a rule rather than a habit.**
// ADR-0008 §2: metric labels are bounded by design against a 10,000
// active-series ceiling, and `account.id` - which is free on a span and is on
// every span this runtime emits - must never appear on a metric. The two label
// sets below multiply out to well under a hundred series and cannot grow with
// traffic, accounts or recipes.

import { metrics } from '@opentelemetry/api';
import { INSTRUMENTATION_SCOPE } from './setup';

// Which Import Source produced an import. Closed set: these are the Sources the
// product has, and a new one is a code change here as much as anywhere else.
export type ImportSource =
  | 'url'
  | 'text'
  | 'photo'
  | 'method-url'
  | 'method-photo';

// How an import ended.
//
// `empty` is separate from `error` because the two mean different things to a
// cook and to whoever is reading the dashboard: `error` is this app failing,
// `empty` is the extraction succeeding against a page that had nothing
// extractable on it. Collapsing them would hide the single most common Import
// complaint (follow-ups.md #40) inside the error rate.
export type ImportResult = 'success' | 'empty' | 'error';

// Resolved lazily, on first use, rather than at module load.
//
// metrics.getMeter() binds to whichever MeterProvider is registered *at the
// moment it is called*, and module initialisation can easily happen before
// instrumentation.ts has installed the real one - in which case a module-level
// const would capture the no-op provider permanently and every measurement
// would vanish with nothing reporting a problem. This is the same trap the Go
// side documents on telemetry.Logger, and the same fix.
let cached: ReturnType<typeof buildInstruments> | undefined;

function buildInstruments() {
  const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);
  return {
    importOutcome: meter.createCounter('bigshop.import.outcome', {
      description: 'Recipe and Method imports, by Source and outcome',
      unit: '{import}',
    }),
    llmTokens: meter.createCounter('bigshop.llm.tokens', {
      description: 'OpenAI tokens consumed, by model and direction',
      unit: '{token}',
    }),
  };
}

function instruments() {
  cached ??= buildInstruments();
  return cached;
}

// Exported for tests, which install their own provider between cases.
export function resetInstruments(): void {
  cached = undefined;
}

// Counts one finished import. Called once per import attempt, on every path out
// of it - including the failures, which are the reason the metric is worth
// having.
export function recordImportOutcome(source: ImportSource, result: ImportResult): void {
  try {
    instruments().importOutcome.add(1, { source, result });
  } catch {
    // Telemetry must never affect the application (ADR-0007). A counter that
    // cannot be incremented is not a reason to fail an import that worked.
  }
}

// The shape of the two OpenAI usage objects this app sees. The Responses API
// (lib/recipe-import/extract.js) reports input_tokens/output_tokens; Chat
// Completions (pages/api/dave/chat.ts) reports prompt_tokens/completion_tokens.
// Both are optional throughout: usage is absent on a streamed or errored call,
// and a missing count must record nothing rather than record a zero, which
// would drag any average computed over this counter towards zero.
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

// Counts the tokens one model call consumed.
//
// `model` is a label, and is safe as one only because this app names its models
// in code - lib/openai-client.ts's EXTRACTION_MODEL and Dave's literal - rather
// than taking them from a request. A model name that could arrive from outside
// would be an unbounded label and would belong on the span instead.
export function recordTokenUsage(model: string, usage: TokenUsage | null | undefined): void {
  if (!usage) return;

  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;

  try {
    const { llmTokens } = instruments();
    if (typeof input === 'number') llmTokens.add(input, { model, direction: 'input' });
    if (typeof output === 'number') llmTokens.add(output, { model, direction: 'output' });
  } catch {
    // As above.
  }
}
