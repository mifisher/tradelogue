import { describe, expect, test, vi, afterEach } from 'vitest';
import { z } from 'zod';
import {
  AiTruncatedError,
  buildMoonshotJsonRequestBody,
  generateStructuredObject,
  extractJsonObject,
  getAiConfig,
  isAiConfigured,
  isAiTruncationError,
  moonshotThinkingParam,
  parseJsonObjectContent,
} from './provider';

describe('extractJsonObject', () => {
  test('recovers JSON from a reasoning model that leaks chain of thought', () => {
    // Observed live: nvidia/nemotron via openrouter/free prefixes its reasoning.
    const leaked = 'Okay, the user is asking for JSON. {"city":"Paris","pop":2}';
    expect(JSON.parse(extractJsonObject(leaked))).toEqual({ city: 'Paris', pop: 2 });
  });

  test('recovers JSON from markdown fences', () => {
    const fenced = '```json\n{"city":"Paris"}\n```';
    expect(JSON.parse(extractJsonObject(fenced))).toEqual({ city: 'Paris' });
  });

  test('does not stop at a brace inside a string', () => {
    const tricky = 'prose {"headline":"Fed said {maybe}","ok":true} trailing';
    expect(JSON.parse(extractJsonObject(tricky))).toEqual({
      headline: 'Fed said {maybe}',
      ok: true,
    });
  });

  test('handles escaped quotes inside strings', () => {
    const escaped = '{"q":"he said \\"hi\\"","n":1}';
    expect(JSON.parse(extractJsonObject(escaped))).toEqual({ q: 'he said "hi"', n: 1 });
  });

  test('returns input unchanged when there is no balanced object', () => {
    expect(extractJsonObject('no json here')).toBe('no json here');
    expect(extractJsonObject('{"truncated":')).toBe('{"truncated":');
  });
});

describe('getAiConfig', () => {
  test('uses Moonshot when only MOONSHOT_API_KEY is present', () => {
    const config = getAiConfig({ MOONSHOT_API_KEY: 'moonshot-key' });

    expect(config.provider).toBe('moonshot');
    expect(config.apiKey).toBe('moonshot-key');
    expect(config.baseUrl).toBe('https://api.moonshot.ai/v1');
    expect(config.models.coach).toBe('kimi-k2.6');
    expect(isAiConfigured(config)).toBe(true);
  });

  test('preserves Anthropic as the default when no Moonshot key is present', () => {
    const config = getAiConfig({ ANTHROPIC_API_KEY: 'anthropic-key' });

    expect(config.provider).toBe('anthropic');
    expect(config.apiKey).toBe('anthropic-key');
    expect(config.models.coach).toBe('claude-opus-4-8');
    expect(config.models.voice).toBe('claude-sonnet-4-6');
    expect(isAiConfigured(config)).toBe(true);
  });

  test('honors explicit provider and model overrides', () => {
    const config = getAiConfig({
      AI_PROVIDER: 'moonshot',
      MOONSHOT_API_KEY: 'moonshot-key',
      MOONSHOT_BASE_URL: 'https://example.test/v1',
      MOONSHOT_MODEL: 'kimi-custom',
      MOONSHOT_VOICE_MODEL: 'kimi-voice',
    });

    expect(config.provider).toBe('moonshot');
    expect(config.baseUrl).toBe('https://example.test/v1');
    expect(config.models.coach).toBe('kimi-custom');
    expect(config.models.voice).toBe('kimi-voice');
    expect(config.models.chat).toBe('kimi-custom');
  });

  test('normalizes an unsupported provider to Anthropic so config fails closed', () => {
    const config = getAiConfig({
      AI_PROVIDER: 'unsupported',
      ANTHROPIC_API_KEY: 'anthropic-key',
      MOONSHOT_API_KEY: 'moonshot-key',
    });

    expect(config.provider).toBe('anthropic');
    expect(config.apiKey).toBe('anthropic-key');
  });
});

describe('parseJsonObjectContent', () => {
  const OutputSchema = z.object({
    items: z.array(z.string()),
  });

  test('parses and validates JSON object content', () => {
    const output = parseJsonObjectContent('{"items":["one","two"]}', OutputSchema, 'test output');

    expect(output).toEqual({ items: ['one', 'two'] });
  });

  test('throws a useful error for invalid JSON', () => {
    expect(() => parseJsonObjectContent('not json', OutputSchema, 'test output')).toThrow(
      'test output returned invalid JSON',
    );
  });

  test('throws a useful error for schema mismatches', () => {
    expect(() => parseJsonObjectContent('{"items":"one"}', OutputSchema, 'test output')).toThrow(
      'test output did not match the expected schema',
    );
  });

  test('names the offending field so the retry hint is actionable', () => {
    // The synthesis retry feeds this message back to the model, so a bare
    // "did not match the schema" leaves it nothing to correct.
    expect(() => parseJsonObjectContent('{"items":"one"}', OutputSchema, 'test output')).toThrow(
      /items/,
    );
  });
});

describe('Moonshot request tuning', () => {
  const OutputSchema = z.object({
    items: z.array(z.string()),
  });

  test('disables thinking for Kimi K2.6 so simple JSON calls are fast and have final content', () => {
    const config = getAiConfig({
      AI_PROVIDER: 'moonshot',
      MOONSHOT_API_KEY: 'moonshot-key',
      MOONSHOT_MODEL: 'kimi-k2.6',
    });

    const body = buildMoonshotJsonRequestBody(
      {
        feature: 'voice',
        system: 'system',
        user: 'user',
        maxTokens: 2048,
        schema: OutputSchema,
        jsonInstruction: '{"items":["string"]}',
        label: 'test output',
      },
      config,
    );

    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  test('does not pass an invalid disabled-thinking parameter to always-thinking K2.7 models', () => {
    expect(moonshotThinkingParam('kimi-k2.7-code')).toBeUndefined();
    expect(moonshotThinkingParam('kimi-k2.7-code-highspeed')).toBeUndefined();
  });
});

describe('OpenRouter reasoning effort', () => {
  const OutputSchema = z.object({ items: z.array(z.string()) });
  const base = {
    feature: 'voice' as const,
    system: 'system',
    user: 'user',
    maxTokens: 2048,
    schema: OutputSchema,
    jsonInstruction: '{"items":["string"]}',
    label: 'test output',
  };
  const openrouter = getAiConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' });

  // glm-5.3-flash has mandatory reasoning with default_effort "max", which cost
  // the voice field ~40s a call for thinking nobody reads. "low" runs ~10s.
  test('passes the requested effort through to OpenRouter', () => {
    const body = buildMoonshotJsonRequestBody({ ...base, reasoningEffort: 'low' }, openrouter);
    expect(body.reasoning).toEqual({ effort: 'low' });
  });

  test('omits reasoning entirely when no effort is requested', () => {
    const body = buildMoonshotJsonRequestBody(base, openrouter);
    expect(body.reasoning).toBeUndefined();
  });

  // Moonshot's native API speaks `thinking`, not OpenRouter's `reasoning`;
  // sending the wrong one is a 400.
  test('does not send OpenRouter reasoning to the native Moonshot API', () => {
    const moonshot = getAiConfig({
      AI_PROVIDER: 'moonshot', MOONSHOT_API_KEY: 'k', MOONSHOT_MODEL: 'kimi-k2.6',
    });
    const body = buildMoonshotJsonRequestBody({ ...base, reasoningEffort: 'low' }, moonshot);
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});

describe('OpenRouter consolidation', () => {
  test('prefers OpenRouter when OPENROUTER_API_KEY is present and no provider is forced', () => {
    const config = getAiConfig({
      OPENROUTER_API_KEY: 'or-key',
      MOONSHOT_API_KEY: 'moonshot-key',
      ANTHROPIC_API_KEY: 'anthropic-key',
    });

    expect(config.provider).toBe('openrouter');
    expect(config.apiKey).toBe('or-key');
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.models.coach).toBe('openrouter/free');
    expect(config.models.brief).toBe('openrouter/free');
    expect(isAiConfigured(config)).toBe(true);
  });

  test('honors OpenRouter global and per-feature model overrides', () => {
    const config = getAiConfig({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_MODEL: 'deepseek/deepseek-chat',
      OPENROUTER_BRIEF_MODEL: 'z-ai/glm-5.2',
    });

    expect(config.models.chat).toBe('deepseek/deepseek-chat');
    expect(config.models.voice).toBe('deepseek/deepseek-chat');
    expect(config.models.brief).toBe('z-ai/glm-5.2');
  });

  test('explicit AI_PROVIDER still beats the OpenRouter key', () => {
    const config = getAiConfig({
      AI_PROVIDER: 'moonshot',
      OPENROUTER_API_KEY: 'or-key',
      MOONSHOT_API_KEY: 'moonshot-key',
    });

    expect(config.provider).toBe('moonshot');
    expect(config.apiKey).toBe('moonshot-key');
  });

  test('every provider carries a brief model', () => {
    expect(getAiConfig({ MOONSHOT_API_KEY: 'k' }).models.brief).toBe('kimi-k2.6');
    expect(getAiConfig({ ANTHROPIC_API_KEY: 'k' }).models.brief).toBe('claude-opus-4-8');
  });
});


describe('reasoning-model failure reporting', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const config = {
    provider: 'openrouter' as const,
    apiKey: 'k',
    baseUrl: 'https://example.test/v1',
    models: { coach: 'm', voice: 'm', chat: 'm', judge: 'm', brief: 'm' },
  };
  const request = {
    feature: 'brief' as const,
    system: 's',
    user: 'u',
    maxTokens: 8000,
    schema: z.object({ ok: z.boolean() }),
    jsonInstruction: 'j',
    label: 'Market brief synthesis',
    config,
  };

  const respond = (body: unknown) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers(),
      json: async () => body,
    }));
  };

  // The exact live failure: glm-5.3-flash spent all 8000 tokens on `reasoning`
  // and returned content:null with finish_reason:"length". The old order checked
  // content first, so this surfaced as the uninformative "returned no content"
  // and cost a full debugging session to identify.
  test('reports a blown token budget as truncation, not missing content', async () => {
    respond({ choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'Let me work through this...' } }] });
    await expect(generateStructuredObject(request)).rejects.toThrow(/truncated|token cap/i);
  });

  test('names the token cap so the fix is obvious', async () => {
    respond({ choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'thinking' } }] });
    await expect(generateStructuredObject(request)).rejects.toThrow(/8000/);
  });

  test('truncation is typed so callers can skip a pointless retry', async () => {
    respond({ choices: [{ finish_reason: 'length', message: { content: null } }] });
    await expect(generateStructuredObject(request)).rejects.toBeInstanceOf(AiTruncatedError);
  });

  // OpenRouter answers 200 with an `error` object and no choices for provider-side
  // failures; that message is the only clue to what went wrong.
  test('surfaces a provider error delivered in a 200 body', async () => {
    respond({ error: { message: 'upstream provider is overloaded', code: 502 } });
    await expect(generateStructuredObject(request)).rejects.toThrow(/upstream provider is overloaded/);
  });

  test('isAiTruncationError distinguishes truncation from other failures', () => {
    expect(isAiTruncationError(new AiTruncatedError('x'))).toBe(true);
    expect(isAiTruncationError(new Error('x'))).toBe(false);
  });
});
