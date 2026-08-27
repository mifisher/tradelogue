import { describe, it, expect } from 'vitest';
import { briefEnvCheck, runStatus } from './brief-pipeline';

describe('briefEnvCheck', () => {
  it('lists every missing key (empty env falls back to the Anthropic provider)', () => {
    expect(briefEnvCheck({})).toEqual({
      configured: false,
      missing: ['ANTHROPIC_API_KEY (AI provider)', 'TAVILY_API_KEY', 'FINNHUB_API_KEY'],
    });
  });

  it('is configured with an OpenRouter key plus search/data keys', () => {
    expect(briefEnvCheck({
      OPENROUTER_API_KEY: 'a', TAVILY_API_KEY: 'b', FINNHUB_API_KEY: 'c',
    })).toEqual({ configured: true, missing: [] });
  });

  it('names the forced provider key when AI_PROVIDER is set but its key is missing', () => {
    expect(briefEnvCheck({ AI_PROVIDER: 'openrouter', TAVILY_API_KEY: 'b', FINNHUB_API_KEY: 'c' })).toEqual({
      configured: false,
      missing: ['OPENROUTER_API_KEY (AI provider)'],
    });
  });
});

describe('runStatus', () => {
  it('is ok with zero failed sources, partial otherwise', () => {
    expect(runStatus(0)).toBe('ok');
    expect(runStatus(1)).toBe('partial');
    expect(runStatus(7)).toBe('partial');
  });
});
