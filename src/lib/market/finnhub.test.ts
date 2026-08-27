import { describe, it, expect, vi } from 'vitest';
import { fetchQuote, lookupQuote, fetchEarningsCalendar, FinnhubError } from './finnhub';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchQuote', () => {
  it('maps the quote payload', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { c: 663.2, d: 1.6, dp: 0.24, pc: 661.6, h: 665, l: 660 }));
    const q = await fetchQuote('SPY', { apiKey: 'fk', fetchFn });
    expect(q).toEqual({ current: 663.2, change: 1.6, changePct: 0.24, prevClose: 661.6, high: 665, low: 660 });
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://finnhub.io/api/v1/quote?symbol=SPY&token=fk');
  });

  it('throws FinnhubError on zeroed payload (unknown symbol)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { c: 0, d: null, dp: null, pc: 0 }));
    await expect(fetchQuote('NOPE', { apiKey: 'fk', fetchFn })).rejects.toThrow(FinnhubError);
  });

  it('throws FinnhubError on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(429, {}));
    await expect(fetchQuote('SPY', { apiKey: 'fk', fetchFn })).rejects.toThrow('Finnhub quote failed (429)');
  });
});

describe('lookupQuote', () => {
  // Finnhub answers an unknown symbol with 200 and a zeroed body, so null is
  // "no such ticker" while a throw stays reserved for a real API failure.
  it('returns null for a zeroed payload instead of throwing', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { c: 0, d: null, dp: null, pc: 0 }));
    expect(await lookupQuote('FORD', { apiKey: 'fk', fetchFn })).toBeNull();
  });

  it('still throws on non-2xx so a flaky request is not read as a bad ticker', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(429, {}));
    await expect(lookupQuote('SPY', { apiKey: 'fk', fetchFn })).rejects.toThrow(FinnhubError);
  });

  it('defaults missing range fields to zero', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { c: 12.5, d: 0.5, dp: 4 }));
    expect(await lookupQuote('X', { apiKey: 'fk', fetchFn })).toEqual({
      current: 12.5, change: 0.5, changePct: 4, prevClose: 0, high: 0, low: 0,
    });
  });
});

describe('fetchEarningsCalendar', () => {
  it('maps the earnings calendar payload', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      earningsCalendar: [
        { symbol: 'TRV', date: '2026-07-20', hour: 'bmo', epsEstimate: 5.34, epsActual: 5.9, revenueEstimate: 12100000000, revenueActual: 12500000000 },
        { symbol: 'MYST', date: '2026-07-21', hour: '', epsEstimate: null, revenueEstimate: null },
      ],
    }));
    const rows = await fetchEarningsCalendar('2026-07-20', '2026-07-26', { apiKey: 'fk', fetchFn });
    expect(rows).toEqual([
      { symbol: 'TRV', date: '2026-07-20', hour: 'bmo', epsEstimate: 5.34, epsActual: 5.9, revenueEstimate: 12100000000, revenueActual: 12500000000 },
      { symbol: 'MYST', date: '2026-07-21', hour: '', epsEstimate: null, epsActual: null, revenueEstimate: null, revenueActual: null },
    ]);
    expect(String(fetchFn.mock.calls[0][0])).toBe(
      'https://finnhub.io/api/v1/calendar/earnings?from=2026-07-20&to=2026-07-26&token=fk',
    );
    expect(fetchFn.mock.calls[0][1]).toEqual({ cache: 'no-store' });
  });
});
