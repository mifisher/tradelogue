import { describe, it, expect } from 'vitest';
import { tradeFingerprint } from './fingerprint';

describe('tradeFingerprint', () => {
  it('returns the first execution id as-is when no prorate suffix', () => {
    expect(tradeFingerprint(['abc123', 'def456'])).toBe('abc123');
  });

  it('strips :a suffix from the first execution id', () => {
    expect(tradeFingerprint(['0001e2b3.01:a', '0001e2b3.01:b'])).toBe('0001e2b3.01');
  });

  it('strips :b suffix from the first execution id', () => {
    expect(tradeFingerprint(['0001e2b3.01:b'])).toBe('0001e2b3.01');
  });

  it('does not strip other suffixes (only :a and :b)', () => {
    expect(tradeFingerprint(['abc:c'])).toBe('abc:c');
  });

  it('throws when executionIds array is empty', () => {
    expect(() => tradeFingerprint([])).toThrow('trade has no executions');
  });
});
