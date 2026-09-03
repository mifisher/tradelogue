import { describe, it, expect } from 'vitest';
import { setupState } from './state';

const CONFIGURED = {
  DATABASE_URL: 'postgresql://trader:trader@localhost:5432/tradelogue',
  NEXT_PUBLIC_TRADING_TIMEZONE: 'America/New_York',
  AI_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'sk-or-abc',
  IBKR_FLEX_TOKEN: 'tok',
  IBKR_FLEX_QUERY_ID: '123',
  TAVILY_API_KEY: 'tv',
  FINNHUB_API_KEY: 'fh',
};

describe('setupState', () => {
  it('reports a fully configured install as done', () => {
    expect(setupState(CONFIGURED)).toEqual({
      database: true,
      timezone: true,
      ai: true,
      ibkr: true,
      market: true,
      needsSetup: false,
      incomplete: false,
    });
  });

  // needsSetup is the gate the root layout uses: without a database the app
  // cannot render anything except the wizard.
  it('flags needsSetup when there is no database url', () => {
    expect(setupState({}).needsSetup).toBe(true);
  });

  it('does not flag needsSetup once the database url is present', () => {
    expect(setupState({ DATABASE_URL: 'postgresql://localhost/x' }).needsSetup).toBe(false);
  });

  it('treats a whitespace-only value as unset', () => {
    expect(setupState({ DATABASE_URL: '   ' }).database).toBe(false);
  });

  it('reports incomplete while AI or IBKR is still missing', () => {
    const state = setupState({ DATABASE_URL: 'postgresql://localhost/x' });
    expect(state).toMatchObject({ incomplete: true, ai: false, ibkr: false });
  });

  // Mirrors syncFromIbkr, which accepts either query id.
  it('accepts either IBKR query id', () => {
    const base = { DATABASE_URL: 'postgresql://localhost/x', IBKR_FLEX_TOKEN: 'tok' };
    expect(setupState({ ...base, IBKR_TRADE_CONFIRM_QUERY_ID: '9' }).ibkr).toBe(true);
    expect(setupState({ ...base, IBKR_FLEX_QUERY_ID: '9' }).ibkr).toBe(true);
    expect(setupState(base).ibkr).toBe(false);
  });

  // Delegates to the provider module, so a key for any supported provider counts
  // and the wizard cannot disagree with what the AI features actually check.
  it('counts a key from any supported provider as AI configured', () => {
    expect(setupState({ ANTHROPIC_API_KEY: 'sk-ant' }).ai).toBe(true);
    expect(setupState({ MOONSHOT_API_KEY: 'ms', AI_PROVIDER: 'moonshot' }).ai).toBe(true);
    expect(setupState({}).ai).toBe(false);
  });

  it('requires both market keys, since the brief needs quotes and news', () => {
    expect(setupState({ TAVILY_API_KEY: 'tv' }).market).toBe(false);
    expect(setupState({ TAVILY_API_KEY: 'tv', FINNHUB_API_KEY: 'fh' }).market).toBe(true);
  });
});
