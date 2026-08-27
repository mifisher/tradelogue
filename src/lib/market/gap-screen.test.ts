import { describe, it, expect } from 'vitest';
import { freshReporters, buildGapScreen } from './gap-screen';
import type { FinnhubEarning } from './finnhub';
import type { YahooQuote } from './yahoo';

const TODAY = '2026-08-06';
const YESTERDAY = '2026-08-05';

function earning(over: Partial<FinnhubEarning> & { symbol: string }): FinnhubEarning {
  return {
    date: TODAY, hour: 'bmo', epsEstimate: 1, epsActual: 1.1,
    revenueEstimate: null, revenueActual: null, ...over,
  };
}

function quote(over: Partial<YahooQuote> & { symbol: string }): YahooQuote {
  return {
    name: null, price: 100, prevClose: 100, open: null, changePct: 0, volume: null,
    avgVolume10Day: null, marketCap: 50_000_000_000, marketState: 'PRE', ...over,
  };
}

function quoteMap(...quotes: YahooQuote[]): Map<string, YahooQuote> {
  return new Map(quotes.map((q) => [q.symbol, q]));
}

describe('freshReporters', () => {
  it('takes before-open names that have already printed today', () => {
    const rows = [earning({ symbol: 'DDOG', epsActual: 0.65 })];
    expect(freshReporters(rows, TODAY).map((r) => r.symbol)).toEqual(['DDOG']);
  });

  // The whole point of the screen is that the news is already out. A name with
  // no actual has not reported, whatever the calendar says about its hour.
  it('excludes a before-open name with no actual yet', () => {
    const rows = [earning({ symbol: 'PENDING', epsActual: null })];
    expect(freshReporters(rows, TODAY)).toEqual([]);
  });

  // Rule: never hold a name into its own earnings. An after-close reporter is
  // banned from Stocks in Play, so it must never enter the screen either.
  it('excludes a name reporting after today close', () => {
    const rows = [earning({ symbol: 'ABNB', hour: 'amc', epsActual: null })];
    expect(freshReporters(rows, TODAY)).toEqual([]);
  });

  // Last night's after-close prints gap this morning just as hard as today's
  // before-open ones — APP was down 20% the morning after its AMC report.
  it('includes last session after-close reporters', () => {
    const rows = [earning({ symbol: 'APP', date: YESTERDAY, hour: 'amc', epsActual: 2.1 })];
    expect(freshReporters(rows, TODAY).map((r) => r.symbol)).toEqual(['APP']);
  });

  it('excludes last session before-open reporters as stale', () => {
    const rows = [earning({ symbol: 'DIS', date: YESTERDAY, hour: 'bmo', epsActual: 1.2 })];
    expect(freshReporters(rows, TODAY)).toEqual([]);
  });

  it('excludes days outside the two-session window', () => {
    const rows = [earning({ symbol: 'OKLO', date: '2026-08-07', epsActual: 0.4 })];
    expect(freshReporters(rows, TODAY)).toEqual([]);
  });
});

describe('buildGapScreen', () => {
  it('ranks by absolute gap so the biggest movers lead in either direction', () => {
    const rows = [earning({ symbol: 'SMALL' }), earning({ symbol: 'DOWN' }), earning({ symbol: 'UP' })];
    const quotes = quoteMap(
      quote({ symbol: 'SMALL', changePct: 4 }),
      quote({ symbol: 'DOWN', changePct: -18.7 }),
      quote({ symbol: 'UP', changePct: 14.2 }),
    );
    expect(buildGapScreen(rows, quotes, TODAY).map((c) => c.ticker)).toEqual(['DOWN', 'UP', 'SMALL']);
  });

  // LWAY reached a real brief as a "stock in play" on a 0.1% move. A microcap
  // with no gap is noise the model should never have to judge.
  it('drops names below the market cap floor', () => {
    const rows = [earning({ symbol: 'LWAY' }), earning({ symbol: 'DDOG' })];
    const quotes = quoteMap(
      quote({ symbol: 'LWAY', changePct: -20, marketCap: 400_000_000 }),
      quote({ symbol: 'DDOG', changePct: -18, marketCap: 81_000_000_000 }),
    );
    const screen = buildGapScreen(rows, quotes, TODAY, { minMarketCap: 2_000_000_000 });
    expect(screen.map((c) => c.ticker)).toEqual(['DDOG']);
  });

  it('drops names that did not gap enough to be in play', () => {
    const rows = [earning({ symbol: 'FLAT' }), earning({ symbol: 'MOVER' })];
    const quotes = quoteMap(
      quote({ symbol: 'FLAT', changePct: 0.4 }),
      quote({ symbol: 'MOVER', changePct: -9 }),
    );
    const screen = buildGapScreen(rows, quotes, TODAY, { minGapPct: 3 });
    expect(screen.map((c) => c.ticker)).toEqual(['MOVER']);
  });

  // An unknown cap is "Yahoo had no figure", not "this is a microcap" — the gap
  // is the real evidence, so the name survives on it.
  it('keeps a name whose market cap is unknown', () => {
    const rows = [earning({ symbol: 'NOCAP' })];
    const quotes = quoteMap(quote({ symbol: 'NOCAP', changePct: -12, marketCap: null }));
    expect(buildGapScreen(rows, quotes, TODAY, { minMarketCap: 2_000_000_000 })).toHaveLength(1);
  });

  it('omits a reporter with no quote rather than treating it as unchanged', () => {
    const rows = [earning({ symbol: 'DDOG' }), earning({ symbol: 'GHOST' })];
    const quotes = quoteMap(quote({ symbol: 'DDOG', changePct: -18 }));
    expect(buildGapScreen(rows, quotes, TODAY).map((c) => c.ticker)).toEqual(['DDOG']);
  });

  it('carries the EPS surprise so the catalyst is quantified', () => {
    const rows = [earning({ symbol: 'DDOG', epsEstimate: 0.6019, epsActual: 0.65 })];
    const quotes = quoteMap(quote({ symbol: 'DDOG', changePct: -18.7 }));
    expect(buildGapScreen(rows, quotes, TODAY)[0].surprisePct).toBeCloseTo(8.0, 1);
  });

  // Unity: estimated a 8.75c loss, printed a 28c profit. Dividing by a signed
  // negative estimate flips that beat into a -420% "miss".
  it('reports a beat against a negative estimate as a positive surprise', () => {
    const rows = [earning({ symbol: 'U', epsEstimate: -0.0875, epsActual: 0.28 })];
    const quotes = quoteMap(quote({ symbol: 'U', changePct: 14.2 }));
    expect(buildGapScreen(rows, quotes, TODAY)[0].surprisePct).toBeCloseTo(420, 0);
  });

  it('leaves surprise null when there was no estimate to beat', () => {
    const rows = [earning({ symbol: 'X', epsEstimate: null, epsActual: 0.5 })];
    const quotes = quoteMap(quote({ symbol: 'X', changePct: 9 }));
    expect(buildGapScreen(rows, quotes, TODAY)[0].surprisePct).toBeNull();
  });

  it('reports relative volume when an average is available', () => {
    const rows = [earning({ symbol: 'DDOG' })];
    const quotes = quoteMap(quote({ symbol: 'DDOG', changePct: -18, volume: 13_000_000, avgVolume10Day: 4_200_000 }));
    expect(buildGapScreen(rows, quotes, TODAY)[0].relVolume).toBeCloseTo(3.1, 1);
  });

  // Premarket the session volume is still near zero, so a ratio would read as
  // "no interest" on the day's biggest gap. Null says "not measurable yet".
  it('leaves relative volume null when the session has no volume yet', () => {
    const rows = [earning({ symbol: 'DDOG' })];
    const quotes = quoteMap(quote({ symbol: 'DDOG', changePct: -18, volume: 0, avgVolume10Day: 4_200_000 }));
    expect(buildGapScreen(rows, quotes, TODAY)[0].relVolume).toBeNull();
  });

  // Ranking purely on gap size lets a $2.8B biotech printing +43% outrank an
  // $82B name down 19%. Measured on a live slate, the low floor pushed DDOG,
  // HUBS and U off the screen entirely in favour of names the trader cannot
  // size into.
  it('excludes a small-cap by default however violently it gapped', () => {
    const rows = [earning({ symbol: 'IOVA' }), earning({ symbol: 'DDOG' })];
    const quotes = quoteMap(
      quote({ symbol: 'IOVA', changePct: 42.6, marketCap: 2_800_000_000 }),
      quote({ symbol: 'DDOG', changePct: -18.6, marketCap: 81_600_000_000 }),
    );
    expect(buildGapScreen(rows, quotes, TODAY).map((c) => c.ticker)).toEqual(['DDOG']);
  });

  it('carries ten names by default so a five-pick section has room to choose', () => {
    const rows = Array.from({ length: 14 }, (_, i) => earning({ symbol: `S${i}` }));
    const quotes = quoteMap(...rows.map((r, i) => quote({ symbol: r.symbol, changePct: -(i + 5) })));
    expect(buildGapScreen(rows, quotes, TODAY)).toHaveLength(10);
  });

  it('caps the screen at the requested size', () => {
    const rows = Array.from({ length: 20 }, (_, i) => earning({ symbol: `S${i}` }));
    const quotes = quoteMap(...rows.map((r, i) => quote({ symbol: r.symbol, changePct: -(i + 5) })));
    expect(buildGapScreen(rows, quotes, TODAY, { limit: 8 })).toHaveLength(8);
  });

  it('records which session the move came from', () => {
    const rows = [
      earning({ symbol: 'DDOG' }),
      earning({ symbol: 'APP', date: YESTERDAY, hour: 'amc' }),
    ];
    const quotes = quoteMap(
      quote({ symbol: 'DDOG', changePct: -18 }),
      quote({ symbol: 'APP', changePct: -20 }),
    );
    const screen = buildGapScreen(rows, quotes, TODAY);
    expect(screen.map((c) => [c.ticker, c.reportedAt])).toEqual([
      ['APP', 'last night after close'],
      ['DDOG', 'this morning before open'],
    ]);
  });
});
