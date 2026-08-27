import { describe, it, expect, vi } from 'vitest';
import { gatherAll, gatherWindowQuotes, profilesFromQuotes, gatherCandidateQuotes, gatherRedditScan } from './gather';
import type { YahooQuote } from './yahoo';

const QUOTE = { c: 663.2, d: 1.6, dp: 0.24 };
// TRV reported before the open with a beat, which is what makes it eligible
// for the gap screen as well as the earnings card.
const EARNINGS = { earningsCalendar: [{ symbol: 'TRV', date: '2026-07-21', hour: 'bmo', epsEstimate: 5.34, revenueEstimate: null, epsActual: 5.9, revenueActual: null }] };
const SP500 = 'observation_date,SP500\n2026-07-17,656.1\n2026-07-20,663.2';
const NDX = 'observation_date,NASDAQ100\n2026-07-17,25520.0\n2026-07-20,25652.95';
const VIX = 'observation_date,VIXCLS\n2026-07-17,18.10\n2026-07-20,18.22';
const BTC = { open: '64000', last: '66560', high: '66700', low: '63900', volume: '1' };
const TAVILY = { results: [{ title: 'T', url: 'https://u', content: 'C', published_date: null }] };
const ECON = [
  { title: 'Advance GDP q/q', country: 'USD', date: '2026-07-30T08:30:00-04:00', impact: 'High', forecast: '2.1%', previous: '2.0%' },
  { title: 'German ifo', country: 'EUR', date: '2026-07-27T04:00:00-04:00', impact: 'Low', forecast: '', previous: '' },
];

/** TRV is the only reporter in the EARNINGS fixture; it reported before today's
 * open and gapped hard, so it drives both the profile lookup and the screen. */
const YAHOO_QUOTE = {
  symbol: 'TRV', marketState: 'PRE', longName: 'Travelers Companies',
  regularMarketPrice: 200, preMarketPrice: 160, regularMarketPreviousClose: 200,
  marketCap: 45_000_000_000,
};

function route(url: string, opts?: { failTavily?: boolean; failEcon?: boolean; failYahoo?: boolean; failReddit?: boolean }) {
  const asJson = (body: unknown, status = 200) =>
    ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
  const asText = (body: string) => ({ ok: true, status: 200, text: async () => body }) as Response;
  if (url.includes('apewisdom.io')) {
    if (opts?.failReddit) return asJson({}, 503);
    return asJson({ results: [{ ticker: 'HTZ', name: 'Hertz', rank: 1, rank_24h_ago: 137, mentions: 675, mentions_24h_ago: 6, upvotes: 3407 }] });
  }
  if (url.includes('tradestie.com')) {
    if (opts?.failReddit) return asJson({}, 500);
    return asJson([{ ticker: 'HTZ', sentiment: 'Bullish', sentiment_score: 0.4, no_of_comments: 30 }]);
  }
  if (url.includes('fc.yahoo.com')) {
    return {
      ok: true, status: 200, text: async () => '',
      headers: new Headers({ 'set-cookie': 'A3=d=tok; Path=/' }),
    } as Response;
  }
  if (url.includes('getcrumb')) {
    return { ok: true, status: 200, text: async () => 'cr', headers: new Headers() } as Response;
  }
  if (url.includes('finance/quote')) {
    if (opts?.failYahoo) return { ok: false, status: 503, json: async () => ({}) } as Response;
    return asJson({ quoteResponse: { result: [YAHOO_QUOTE] } });
  }
  if (url.includes('finnhub.io/api/v1/quote')) return asJson(QUOTE);
  if (url.includes('finnhub.io/api/v1/calendar/earnings')) return asJson(EARNINGS);
  if (url.includes('fredgraph.csv?id=SP500')) return asText(SP500);
  if (url.includes('fredgraph.csv?id=NASDAQ100')) return asText(NDX);
  if (url.includes('fredgraph.csv?id=VIXCLS')) return asText(VIX);
  if (url.includes('api.exchange.coinbase.com')) return asJson(BTC);
  if (url.includes('api.tavily.com')) return opts?.failTavily ? asJson({}, 500) : asJson(TAVILY);
  if (url.includes('faireconomy.media')) return opts?.failEcon ? asJson({}, 503) : asJson(ECON);
  throw new Error(`unrouted url ${url}`);
}

describe('gatherWindowQuotes', () => {
  const earning = (symbol: string, date: string, revenueEstimate: number | null) => ({
    symbol, date, hour: 'bmo', epsEstimate: null, revenueEstimate, epsActual: null, revenueActual: null,
  });

  const yahooRoute = (priced: Record<string, { cap?: number; name?: string }>) =>
    vi.fn((url: string) => {
      const href = String(url);
      if (href.includes('fc.yahoo.com')) {
        return Promise.resolve({
          ok: true, status: 200, text: async () => '',
          headers: new Headers({ 'set-cookie': 'A3=d=tok; Path=/' }),
        } as Response);
      }
      if (href.includes('getcrumb')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => 'cr', headers: new Headers() } as Response);
      }
      const symbols = new URL(href).searchParams.get('symbols')?.split(',') ?? [];
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          quoteResponse: {
            result: symbols.filter((s) => priced[s]).map((s) => ({
              symbol: s, marketState: 'PRE',
              regularMarketPrice: 100, regularMarketPreviousClose: 100,
              marketCap: priced[s].cap, longName: priced[s].name,
            })),
          },
        }),
      } as Response);
    });

  const opts = (fetchFn: ReturnType<typeof yahooRoute>) =>
    ({ fetchFn: fetchFn as unknown as typeof fetch });

  // The whole point of the rewrite. DDOG is an $82B company whose quarterly
  // revenue ranks it 68th on a busy day; the old revenue-gated pool priced the
  // top 45 only, so it had no cap, sorted as zero, and fell out of the card.
  it('prices a large name that revenue ranks far down the slate', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => earning(`BIG${i}`, '2026-07-21', 9e9 - i));
    rows.push(earning('DDOG', '2026-07-21', 1.1e9));
    const fetchFn = yahooRoute({ DDOG: { cap: 81_952_710_656, name: 'Datadog, Inc.' } });

    const quotes = await gatherWindowQuotes(rows, opts(fetchFn));

    expect(quotes.get('DDOG')?.marketCap).toBe(81_952_710_656);
    expect(quotes.get('DDOG')?.name).toBe('Datadog, Inc.');
  });

  // The card spans five sessions and ranks each of them, so pricing only the
  // current day left the other four ranking on revenue alone.
  it('prices reporters on every day in the window, not just today', async () => {
    const fetchFn = yahooRoute({
      TODAY: { cap: 1000, name: 'Today Inc' },
      LATER: { cap: 2000, name: 'Later Co' },
    });
    const quotes = await gatherWindowQuotes(
      [earning('TODAY', '2026-07-21', 1e9), earning('LATER', '2026-07-23', 1e9)],
      opts(fetchFn),
    );
    expect(quotes.get('TODAY')?.marketCap).toBe(1000);
    expect(quotes.get('LATER')?.marketCap).toBe(2000);
  });

  it('does not touch the network for an empty calendar', async () => {
    const fetchFn = yahooRoute({});
    expect((await gatherWindowQuotes([], opts(fetchFn))).size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('asks for each symbol once even when a name reports twice in the window', async () => {
    const fetchFn = yahooRoute({ DUP: { cap: 5, name: 'Dup Co' } });
    await gatherWindowQuotes(
      [earning('DUP', '2026-07-21', 1), earning('DUP', '2026-07-22', 1)],
      opts(fetchFn),
    );
    const quoteCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('finance/quote'));
    expect(new URL(String(quoteCall![0])).searchParams.get('symbols')).toBe('DUP');
  });
});

describe('profilesFromQuotes', () => {
  const q = (over: Partial<YahooQuote> & { symbol: string }): YahooQuote => ({
    name: null, price: 1, prevClose: 1, open: null, changePct: 0, volume: null,
    avgVolume10Day: null, marketCap: null, marketState: 'PRE', ...over,
  });

  it('splits the quote map into caps for ranking and names for display', () => {
    const { marketCaps, companyNames } = profilesFromQuotes(new Map([
      ['DDOG', q({ symbol: 'DDOG', marketCap: 81_952_710_656, name: 'Datadog, Inc.' })],
    ]));
    expect(marketCaps.get('DDOG')).toBe(81_952_710_656);
    expect(companyNames.get('DDOG')).toBe('Datadog, Inc.');
  });

  // Missing must stay missing: selectEarnings reads an absent cap as zero and
  // falls back to revenue, and an absent name falls back to the ticker.
  it('omits an unnamed or uncapitalised quote rather than storing a placeholder', () => {
    const { marketCaps, companyNames } = profilesFromQuotes(new Map([
      ['NOCAP', q({ symbol: 'NOCAP', marketCap: null, name: 'No Cap Co' })],
      ['NONAME', q({ symbol: 'NONAME', marketCap: 500, name: null })],
    ]));
    expect(marketCaps.has('NOCAP')).toBe(false);
    expect(companyNames.get('NOCAP')).toBe('No Cap Co');
    expect(marketCaps.get('NONAME')).toBe(500);
    expect(companyNames.has('NONAME')).toBe(false);
  });
});

describe('gatherAll', () => {
  it('gathers quotes, earnings, and searches; all ok', async () => {
    const fetchFn = vi.fn((url: string) => Promise.resolve(route(String(url))));
    const g = await gatherAll({
      finnhubKey: 'fk', tavilyKey: 'tk', todayPt: '2026-07-20',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(g.quotes.status).toBe('ok');
    const assets = g.quotes.data!.assets;
    expect(assets.map((a) => a.symbol)).toEqual(['SPY', 'QQQ', 'VIX', 'BTC']);
    expect(assets[0].value).toBe(663.2);
    expect(assets[0].sparkline).toEqual([656.1, 663.2]);
    expect(assets[2].value).toBe(18.22);
    expect(assets[2].change).toBeCloseTo(0.12, 5);
    expect(assets[3].value).toBe(66560);
    expect(assets[3].change).toBeCloseTo(2560, 5);
    expect(assets[3].changePct).toBeCloseTo(4, 5);
    expect(g.earningsCalendar.status).toBe('ok');
    // US releases only, straight from the feed — no LLM in the path.
    expect(g.econCalendar.status).toBe('ok');
    expect(g.econCalendar.data).toEqual([{
      date: '2026-07-30', timeEt: '08:30', timeUtc: '2026-07-30T12:30:00.000Z',
      name: 'Advance GDP q/q', expected: '2.1%', previous: '2.0%', impact: 'high', note: null,
    }]);
    expect(g.searches.length).toBeGreaterThanOrEqual(5);
    expect(g.failedSourceCount).toBe(0);
  });

  it('counts a dead econ feed as one failed source and keeps the rest', async () => {
    const fetchFn = vi.fn((url: string) => Promise.resolve(route(String(url), { failEcon: true })));
    const g = await gatherAll({
      finnhubKey: 'fk', tavilyKey: 'tk', todayPt: '2026-07-20',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(g.econCalendar.status).toBe('failed');
    expect(g.econCalendar.error).toContain('503');
    expect(g.quotes.status).toBe('ok');
    expect(g.failedSourceCount).toBe(1);
  });

  it('degrades per-source instead of failing the gather', async () => {
    const fetchFn = vi.fn((url: string) => Promise.resolve(route(String(url), { failTavily: true })));
    const g = await gatherAll({
      finnhubKey: 'fk', tavilyKey: 'tk', todayPt: '2026-07-20',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(g.quotes.status).toBe('ok');
    expect(g.searches.every((s) => s.source.status === 'failed')).toBe(true);
    expect(g.failedSourceCount).toBe(g.searches.length);
    expect(g.searches[0].source.error).toContain('500');
  });

  // One Yahoo pass serves both: the caps and names that rank the earnings card,
  // and the gap screen behind Stocks in Play.
  it('feeds the earnings profiles and the gap screen from the same window pass', async () => {
    const fetchFn = vi.fn((url: string) => Promise.resolve(route(String(url))));
    const g = await gatherAll({
      finnhubKey: 'fk', tavilyKey: 'tk', todayPt: '2026-07-21',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(g.companyNames.get('TRV')).toBe('Travelers Companies');
    expect(g.marketCaps.get('TRV')).toBe(45_000_000_000);
    expect(g.gapScreen.status).toBe('ok');
    expect(g.gapScreen.data!.map((c) => c.ticker)).toEqual(['TRV']);
    expect(g.gapScreen.data![0].gapPct).toBeCloseTo(-20, 5);

    const quoteCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes('finance/quote'));
    expect(quoteCalls).toHaveLength(1);
  });

  it('counts a dead Yahoo as one failed source and still returns a brief', async () => {
    const fetchFn = vi.fn((url: string) => Promise.resolve(route(String(url), { failYahoo: true })));
    const g = await gatherAll({
      finnhubKey: 'fk', tavilyKey: 'tk', todayPt: '2026-07-21',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(g.gapScreen.status).toBe('failed');
    expect(g.gapScreen.error).toContain('503');
    // Names fall back to tickers and ranking falls back to revenue.
    expect(g.marketCaps.size).toBe(0);
    expect(g.companyNames.size).toBe(0);
    expect(g.earningsCalendar.status).toBe('ok');
    expect(g.failedSourceCount).toBe(1);
  });
});

describe('gatherRedditScan', () => {
  const apeRow = (ticker: string, mentions: number, ago: number | null) =>
    ({ ticker, name: ticker, rank: 1, rank_24h_ago: 1, mentions, mentions_24h_ago: ago, upvotes: 10 });

  const redditRoute = (opts: { failSubs?: string[]; failSentiment?: boolean } = {}) =>
    vi.fn((url: string) => {
      const href = String(url);
      if (href.includes('tradestie')) {
        if (opts.failSentiment) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => [{ ticker: 'HTZ', sentiment: 'Bullish', sentiment_score: 0.4, no_of_comments: 30 }],
        } as Response);
      }
      const sub = href.split('/filter/')[1]?.split('/')[0] ?? '';
      if (opts.failSubs?.includes(sub)) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ results: sub === 'wallstreetbets' ? [apeRow('HTZ', 675, 6), apeRow('DDOG', 25, 8)] : [apeRow('VOO', 60, 55)] }),
      } as Response);
    });

  it('merges mention volume with sentiment and flags the brief overlap', async () => {
    const scan = await gatherRedditScan(new Set(['DDOG']), {
      fetchFn: redditRoute() as unknown as typeof fetch,
    });
    const htz = scan.find((s) => s.ticker === 'HTZ')!;
    expect(htz.momentum).toBeCloseTo(112.5, 1);
    expect(htz.sentiment).toBe('bullish');
    expect(scan[0].ticker).toBe('DDOG');
    expect(scan[0].inTodaysBrief).toBe(true);
  });

  // Sentiment is the garnish; mention volume is the substance. Losing the
  // direction feed should cost the arrows, not the whole section.
  it('keeps the scan when the sentiment feed is down, with direction unknown', async () => {
    const scan = await gatherRedditScan(new Set(), {
      fetchFn: redditRoute({ failSentiment: true }) as unknown as typeof fetch,
    });
    expect(scan.length).toBeGreaterThan(0);
    expect(scan.every((s) => s.sentiment === null)).toBe(true);
  });

  it('keeps the surviving subreddits when one of them fails', async () => {
    const scan = await gatherRedditScan(new Set(), {
      fetchFn: redditRoute({ failSubs: ['stocks', 'investing', 'options'] }) as unknown as typeof fetch,
    });
    expect(scan.map((s) => s.ticker)).toContain('HTZ');
  });

  it('throws only when every subreddit is unreachable', async () => {
    await expect(gatherRedditScan(new Set(), {
      fetchFn: redditRoute({ failSubs: ['wallstreetbets', 'stocks', 'investing', 'options'] }) as unknown as typeof fetch,
    })).rejects.toThrow();
  });
});

describe('gatherCandidateQuotes', () => {
  const bundle = (key: string, content: string) => ({
    key,
    label: key,
    source: { status: 'ok' as const, data: [{ title: '', url: 'https://u', content, publishedDate: null }], error: null },
  });

  const quoteRoute = (unknown: string[] = [], failFor: string[] = []) =>
    vi.fn((url: string) => {
      const symbol = new URL(String(url)).searchParams.get('symbol') ?? '';
      if (failFor.includes(symbol)) {
        return Promise.resolve({ ok: false, status: 429, json: async () => ({}) } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => (unknown.includes(symbol)
          ? { c: 0, d: null, dp: null, pc: 0, h: 0, l: 0 }
          : { c: 100, d: 5, dp: 5.25, pc: 95, h: 101, l: 98 }),
      } as Response);
    });

  it('prices the tickers named in the catalyst searches', async () => {
    const fetchFn = quoteRoute();
    const quotes = await gatherCandidateQuotes(
      [bundle('premarket-movers', 'Nvidia (NASDAQ: NVDA) gapped up; $AMD followed.')],
      { finnhubKey: 'fk', fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect([...quotes.keys()].sort()).toEqual(['AMD', 'NVDA']);
    expect(quotes.get('NVDA')).toMatchObject({ current: 100, prevClose: 95 });
  });

  it('skips Reddit threads, which are a ticker soup', async () => {
    const fetchFn = quoteRoute();
    const quotes = await gatherCandidateQuotes(
      [bundle('reddit-wsb', '$GME $AMC to the moon')],
      { finnhubKey: 'fk', fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(quotes.size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('omits a symbol Finnhub does not know rather than storing a zero quote', async () => {
    const quotes = await gatherCandidateQuotes(
      [bundle('top-stories', 'Shares of NVDA and BOGUS moved.')],
      { finnhubKey: 'fk', fetchFn: quoteRoute(['BOGUS']) as unknown as typeof fetch },
    );
    expect([...quotes.keys()]).toEqual(['NVDA']);
  });

  it('loses one candidate, not the brief, when a quote call fails', async () => {
    const quotes = await gatherCandidateQuotes(
      [bundle('top-stories', 'NVDA and AMD are active.')],
      { finnhubKey: 'fk', fetchFn: quoteRoute([], ['AMD']) as unknown as typeof fetch },
    );
    expect([...quotes.keys()]).toEqual(['NVDA']);
  });

  it('ignores failed searches and caps how many candidates it prices', async () => {
    const fetchFn = quoteRoute();
    const quotes = await gatherCandidateQuotes(
      [
        { key: 'top-stories', label: 't', source: { status: 'failed' as const, data: null, error: 'boom' } },
        bundle('premarket-movers', 'AAPL AMZN GOOG META MSFT NVDA TSLA NFLX'),
      ],
      { finnhubKey: 'fk', fetchFn: fetchFn as unknown as typeof fetch, limit: 3 },
    );
    expect(quotes.size).toBe(3);
  });
});
