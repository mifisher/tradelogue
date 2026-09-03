import { describe, it, expect } from 'vitest';
import { WRITABLE_KEYS, isSecretKey, maskSecret, validateUpdates } from './keys';

describe('validateUpdates', () => {
  it('passes through allowlisted keys', () => {
    expect(validateUpdates({ FINNHUB_API_KEY: 'fh-1' })).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });

  // The browser is a trust boundary even on localhost: without the allowlist,
  // a crafted request could write PATH or NODE_OPTIONS into the file the app
  // and every CLI script source at boot.
  it('rejects a key that is not on the allowlist', () => {
    expect(() => validateUpdates({ NODE_OPTIONS: '--inspect' })).toThrow(/not a Tradelogue setting/);
  });

  it('rejects a non-string value', () => {
    expect(() => validateUpdates({ FINNHUB_API_KEY: 42 })).toThrow(/must be text/);
  });

  it('rejects a value containing a newline, which would forge extra keys', () => {
    expect(() => validateUpdates({ FINNHUB_API_KEY: 'a\nPATH=/evil' })).toThrow(/single line/);
  });

  it('trims surrounding whitespace, which is the usual copy-paste damage', () => {
    expect(validateUpdates({ FINNHUB_API_KEY: '  fh-1  ' })).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });

  it('allows an empty value so a key can be cleared', () => {
    expect(validateUpdates({ FINNHUB_API_KEY: '' })).toEqual({ FINNHUB_API_KEY: '' });
  });
});

describe('WRITABLE_KEYS', () => {
  it('covers every field the wizard collects', () => {
    for (const key of [
      'DATABASE_URL',
      'NEXT_PUBLIC_TRADING_TIMEZONE',
      'AI_PROVIDER',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'OPENROUTER_COACH_MODEL',
      'OPENROUTER_VOICE_MODEL',
      'OPENROUTER_CHAT_MODEL',
      'OPENROUTER_BRIEF_MODEL',
      'OPENROUTER_JUDGE_MODEL',
      'MOONSHOT_API_KEY',
      'ANTHROPIC_API_KEY',
      'IBKR_FLEX_TOKEN',
      'IBKR_FLEX_QUERY_ID',
      'IBKR_TRADE_CONFIRM_QUERY_ID',
      'TAVILY_API_KEY',
      'FINNHUB_API_KEY',
      'RULE_OUTLAY_CAP',
      'RULE_REENTRY_PAUSE_MIN',
      'RULE_CIRCUIT_BREAKER',
      'RULE_CHOP_TRADE_CAP',
      'RULE_SESSION_OPEN_HOUR',
    ]) {
      expect(WRITABLE_KEYS).toContain(key);
    }
  });
});

describe('isSecretKey', () => {
  it('treats tokens and API keys as secret', () => {
    expect(isSecretKey('OPENROUTER_API_KEY')).toBe(true);
    expect(isSecretKey('IBKR_FLEX_TOKEN')).toBe(true);
    expect(isSecretKey('DATABASE_URL')).toBe(true);
  });

  it('does not treat model names or thresholds as secret', () => {
    expect(isSecretKey('OPENROUTER_MODEL')).toBe(false);
    expect(isSecretKey('RULE_OUTLAY_CAP')).toBe(false);
  });
});

describe('maskSecret', () => {
  it('shows enough of a key to recognise it without revealing it', () => {
    expect(maskSecret('sk-or-v1-0123456789abcdef')).toBe('sk-or-…cdef');
  });

  // A short value has no safe prefix to show, so show nothing.
  it('fully masks a value too short to excerpt', () => {
    expect(maskSecret('abcd')).toBe('………');
  });

  it('returns an empty string unchanged so "unset" stays visible', () => {
    expect(maskSecret('')).toBe('');
  });
});
