import { describe, it, expect } from 'vitest';
import { tradeLabel } from './trade-label';

describe('tradeLabel', () => {
  it('formats a put with an integer strike', () => {
    expect(
      tradeLabel({ underlying: 'NVDA', putCall: 'P', strike: 170, description: 'x' }),
    ).toBe('NVDA 170P');
  });

  it('formats a call with a fractional strike', () => {
    expect(
      tradeLabel({ underlying: 'TSLA', putCall: 'C', strike: 247.5, description: 'x' }),
    ).toBe('TSLA 247.5C');
  });

  it('drops the strike when none is present', () => {
    expect(
      tradeLabel({ underlying: 'AAPL', putCall: 'C', strike: null, description: 'x' }),
    ).toBe('AAPL C');
  });

  it('falls back to the underlying for non-option trades', () => {
    expect(
      tradeLabel({ underlying: 'SPY', putCall: null, strike: null, description: 'x' }),
    ).toBe('SPY');
  });
});
