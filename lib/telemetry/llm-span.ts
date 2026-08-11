// One span per OpenAI call.
//
// These calls dominate the latency of every route they appear on - seconds,
// against milliseconds for everything around them - which is what makes ADR-0007
// relaxed about the synchronous flush on this side: a 250ms bound is
// proportionally noise next to the thing it sits beside. It is also why the call
// deserves a span of its own: without one, "the import was slow" cannot be told
// apart from "OpenAI was slow", and they have entirely different fixes.
//
// What the span carries is the model, the operation, and whether it threw.
// **Not the prompt and not the completion** - ADR-0008 §1 names them, and the
// cost of that is stated there rather than hidden: when an extraction fails
// because the model returned unparseable JSON, the response body *is* the
// evidence and it will not be in the trace.

import { SpanStatusCode } from '@opentelemetry/api';
import { tracer } from './setup';
import { safeError } from './span';

export async function llmSpan<T>(
  model: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return tracer().startActiveSpan(`openai ${operation}`, async (span) => {
    // Named to match OTel's GenAI semantic conventions, which are still
    // experimental - so the keys are written as literals rather than imported
    // from @opentelemetry/semantic-conventions, whose incubating exports rename
    // between minor versions.
    span.setAttribute('gen_ai.system', 'openai');
    span.setAttribute('gen_ai.request.model', model);
    span.setAttribute('gen_ai.operation.name', operation);

    try {
      return await fn();
    } catch (error) {
      span.recordException(safeError(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
