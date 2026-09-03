import { describe, it, expect } from 'vitest';
import { describeAiError, describeError } from './test-result';
import { AiProviderError, AiTruncatedError, getAiConfig } from '@/lib/ai/provider';
import { FlexError } from '@/lib/flex-client';

const OPENROUTER = getAiConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-x' });

describe('describeAiError', () => {
  it('names the env var to fix when the key is rejected', () => {
    const result = describeAiError(new AiProviderError('nope', 401, 'auth'), OPENROUTER);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/OPENROUTER_API_KEY/);
  });

  // The request reached the model and the model answered — the budget ran out
  // on the way back. Reporting that as a failed key would send the user to
  // re-paste a key that was never the problem.
  it('treats a truncated response as a working key with a caveat', () => {
    const result = describeAiError(new AiTruncatedError('ran out at 256'), OPENROUTER);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/reasons past/i);
  });

  it('passes a rate limit through as a retry, not a bad key', () => {
    const result = describeAiError(new AiProviderError('slow down', 429, 'rate_limit'), OPENROUTER);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rate limit/i);
  });

  // A wrong model name is the second most common mistake after a wrong key,
  // and the provider reports it as a plain API error.
  it('surfaces the provider text for anything else', () => {
    const result = describeAiError(
      new AiProviderError('OpenRouter API error (404): no such model', 404, 'api'),
      OPENROUTER,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no such model/);
  });
});

describe('describeError', () => {
  // FlexError messages are already written for a trader to read; wrapping them
  // produced doubled-up advice in sync-actions, so they pass through verbatim.
  it('passes a FlexError through unchanged', () => {
    expect(describeError(new FlexError('IBKR is rate-limiting this token.'), 'fallback')).toEqual({
      ok: false,
      message: 'IBKR is rate-limiting this token.',
    });
  });

  it('uses an Error message when there is one', () => {
    expect(describeError(new Error('connection refused'), 'fallback').message).toBe('connection refused');
  });

  it('falls back when something without a message is thrown', () => {
    expect(describeError('weird', 'Could not connect').message).toBe('Could not connect');
  });
});
