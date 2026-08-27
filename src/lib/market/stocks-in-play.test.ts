import { describe, it, expect, vi } from 'vitest';
import { dedupeStocksInPlay, filterStocksInPlay, finalizeStocksInPlay } from './stocks-in-play';

const pick = (ticker: string, catalyst = 'c') => ({ ticker, catalyst, signal: 's', approach: 'a' });

/** Finnhub answers an unknown symbol with 200 and a zeroed body, so `unknown`
 * models a fabricated ticker rather than an error. */
const quoteFetch = (unknown: string[] = [], failFor: string[] = []) =>
  vi.fn(async (url: string) => {
    const symbol = new URL(String(url)).searchParams.get('symbol') ?? '';
    if (failFor.includes(symbol)) return { ok: false, status: 429, json: async () => ({}) } as Response;
    return {
      ok: true,
      status: 200,
      json: async () =>
        unknown.includes(symbol)
          ? { c: 0, d: null, dp: null, pc: 0, h: 0, l: 0 }
          : { c: 100, d: 5, dp: 5.25, pc: 95, h: 101, l: 98 },
    } as Response;
  }) as unknown as typeof fetch;

const opts = (fetchFn: typeof fetch, lateReporters: string[] = []) => ({
  lateReporters: new Set(lateReporters),
  finnhubKey: 'fk',
  fetchFn,
});

describe('dedupeStocksInPlay', () => {
  it('keeps the first mention of a repeated ticker', () => {
    const out = dedupeStocksInPlay([pick('MSFT', 'first'), pick('BTC'), pick('MSFT', 'second')]);
    expect(out.map((p) => p.ticker)).toEqual(['MSFT', 'BTC']);
    expect(out[0].catalyst).toBe('first');
  });

  it('treats case and stray whitespace as the same name', () => {
    expect(dedupeStocksInPlay([pick('msft'), pick(' MSFT ')]).map((p) => p.ticker)).toEqual(['msft']);
  });

  it('drops blank tickers', () => {
    expect(dedupeStocksInPlay([pick('  '), pick('F')]).map((p) => p.ticker)).toEqual(['F']);
  });
});

describe('filterStocksInPlay', () => {
  it("drops picks reporting after today's close, case-insensitively", () => {
    const kept = filterStocksInPlay([pick('aapl'), pick('NVDA'), pick(' AMZN ')], new Set(['AAPL', 'AMZN']));
    expect(kept.map((p) => p.ticker)).toEqual(['NVDA']);
  });

  it('passes everything through when nothing reports late', () => {
    expect(filterStocksInPlay([pick('NVDA')], new Set()).map((p) => p.ticker)).toEqual(['NVDA']);
  });
});

describe('finalizeStocksInPlay', () => {
  it('attaches a real quote to each pick', async () => {
    const out = await finalizeStocksInPlay([pick('NVDA')], opts(quoteFetch()));
    expect(out).toEqual([
      { ...pick('NVDA'), quote: { price: 100, changePct: 5.25, prevClose: 95, dayHigh: 101, dayLow: 98 } },
    ]);
  });

  it('drops a ticker Finnhub does not know — the model invented it', async () => {
    const out = await finalizeStocksInPlay([pick('FORD'), pick('F')], opts(quoteFetch(['FORD'])));
    expect(out.map((p) => p.ticker)).toEqual(['F']);
  });

  it('keeps the pick with a null quote when Finnhub errors — that is our problem, not the name\'s', async () => {
    const out = await finalizeStocksInPlay([pick('NVDA')], opts(quoteFetch([], ['NVDA'])));
    expect(out).toEqual([{ ...pick('NVDA'), quote: null }]);
  });

  it('nulls the session range before the open rather than reporting a $0 low', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ c: 100, d: 5, dp: 5.25, pc: 95, h: 0, l: 0 }),
    } as Response)) as unknown as typeof fetch;
    const [out] = await finalizeStocksInPlay([pick('NVDA')], opts(fetchFn));
    expect(out.quote).toMatchObject({ price: 100, prevClose: 95, dayHigh: null, dayLow: null });
  });

  it('excludes late reporters and repeats before spending a quote call on them', async () => {
    const fetchFn = quoteFetch();
    const out = await finalizeStocksInPlay(
      [pick('AAPL'), pick('NVDA'), pick('nvda'), pick('AMD')],
      opts(fetchFn, ['AAPL']),
    );
    expect(out.map((p) => p.ticker)).toEqual(['NVDA', 'AMD']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns nothing for an empty pick list without calling Finnhub', async () => {
    const fetchFn = quoteFetch();
    expect(await finalizeStocksInPlay([], opts(fetchFn))).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
