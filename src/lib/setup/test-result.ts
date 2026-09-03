import {
  AiProviderError,
  AiTruncatedError,
  invalidApiKeyMessage,
  type AiConfig,
} from '@/lib/ai/provider';

export interface TestResult {
  ok: boolean;
  message: string;
}

export function describeError(err: unknown, fallback: string): TestResult {
  const message = err instanceof Error && err.message ? err.message : fallback;
  return { ok: false, message };
}

export function describeAiError(err: unknown, config: AiConfig): TestResult {
  // Truncation means the request authenticated, reached the model, and the
  // model answered — it just spent the budget thinking. That is a note about
  // model choice, not a broken key, and calling it a failure would send the
  // user back to re-paste a key that was fine.
  if (err instanceof AiTruncatedError) {
    return {
      ok: true,
      message:
        'Key works. This model reasons past a short token budget — fine for coaching, ' +
        'a poor choice for the voice slot where you are watching it fill in fields.',
    };
  }

  if (err instanceof AiProviderError) {
    if (err.kind === 'auth') return { ok: false, message: invalidApiKeyMessage(config) };
    if (err.kind === 'rate_limit') {
      return { ok: false, message: 'Rate limited by the provider — try again in a minute.' };
    }
  }

  return describeError(err, 'Could not reach the provider.');
}
