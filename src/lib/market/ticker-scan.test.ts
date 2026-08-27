import { describe, it, expect } from 'vitest';
import { scanTickers } from './ticker-scan';

describe('scanTickers', () => {
  it('picks up exchange-prefixed, cashtag and parenthesised forms', () => {
    const found = scanTickers([
      'Microsoft Corp (NASDAQ: MSFT) rose premarket.',
      'Traders piled into $AMD after the upgrade.',
      'Ford Motor (F) guided higher.',
    ]);
    expect(found).toEqual(expect.arrayContaining(['MSFT', 'AMD', 'F']));
  });

  it('ranks a name written several ways above a single bare mention', () => {
    const found = scanTickers([
      'NVDA led the tape. $NVDA volume was heavy. Nvidia (NASDAQ: NVDA) gapped up.',
      'Elsewhere KO was quiet.',
    ]);
    expect(found[0]).toBe('NVDA');
  });

  it('drops acronyms that read like tickers', () => {
    const found = scanTickers(['The FDA and the FOMC weighed on GDP; AI capex and CEO commentary dominated.']);
    expect(found).toEqual([]);
  });

  it('honours the limit so each candidate stays worth a quote call', () => {
    const text = 'AAPL AMZN GOOG META MSFT NVDA TSLA NFLX ORCL CRM ADBE INTC';
    expect(scanTickers([text], { limit: 3 })).toHaveLength(3);
  });

  it('is deterministic when candidates tie', () => {
    const text = 'AAPL and ZM moved.';
    expect(scanTickers([text])).toEqual(scanTickers([text]));
    expect(scanTickers([text])).toEqual(['AAPL', 'ZM']); // alphabetical tie-break
  });

  it('ignores empty and missing text without throwing', () => {
    expect(scanTickers(['', 'MSFT gapped up'])).toEqual(['MSFT']);
  });

  it('skips words too long to be a ticker', () => {
    expect(scanTickers(['EARNINGS REPORTED YESTERDAY'])).toEqual([]);
  });

  // Title case is the common form in headlines and is not a ticker shape, so
  // "Microsoft Beats Estimates" must not contribute MICROSOFT/BEATS.
  it('only matches all-caps tokens, leaving title case alone', () => {
    expect(scanTickers(['Microsoft Beats Estimates As Azure Grows'])).toEqual([]);
  });
});
