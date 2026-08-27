import { describe, it, expect, vi } from 'vitest';
import { buildBriefPrompt, buildEarnings, buildRedditRows, collectSourceLinks, lateReportersToday, selectEarnings, synthesizeBrief, type RuleContext } from './synthesize';
import { AiProviderError } from '../ai/provider';
import type { GatherResult } from './gather';
import type { StoredEconEvent } from './brief-schema';

/** Finnhub /quote stub for the post-synthesis pick enrichment: every symbol
 * resolves except those named, which come back zeroed the way Finnhub answers
 * an unknown ticker. */
const quoteFetch = (unknown: string[] = []) =>
  vi.fn(async (url: string) => {
    const symbol = new URL(String(url)).searchParams.get('symbol') ?? '';
    return {
      ok: true,
      status: 200,
      json: async () =>
        unknown.includes(symbol)
          ? { c: 0, d: null, dp: null, pc: 0, h: 0, l: 0 }
          : { c: 100, d: 5, dp: 5.25, pc: 95, h: 101, l: 98 },
    } as Response;
  }) as unknown as typeof fetch;

const ECON: StoredEconEvent[] = [
  {
    date: '2026-07-20', timeEt: '08:30', timeUtc: '2026-07-20T12:30:00.000Z',
    name: 'Import Prices m/m', expected: '-0.7%', previous: '1.7%', impact: 'medium', note: null,
  },
];

const gather: GatherResult = {
  marketCaps: new Map<string, number>(),
  companyNames: new Map<string, string>([['TRV', 'Travelers Companies']]),
  candidateQuotes: new Map([
    ['NVDA', { current: 180.25, change: 6.1, changePct: 3.5, prevClose: 174.15, high: 181.4, low: 176.2 }],
  ]),
  quotes: {
    status: 'ok',
    data: {
      assets: [{ symbol: 'SPY', label: 'S&P 500 (SPY)', value: 663.2, change: 1.6, changePct: 0.24, sparkline: [656.1, 663.2] }],
      asOfUtc: '2026-07-20T11:30:00.000Z',
    },
    error: null,
  },
  earningsCalendar: {
    status: 'ok',
    data: [{ symbol: 'TRV', date: '2026-07-21', hour: 'bmo', epsEstimate: 5.34, revenueEstimate: null , epsActual: null, revenueActual: null}],
    error: null,
  },
  econCalendar: { status: 'ok', data: ECON, error: null },
  gapScreen: { status: 'ok', data: [], error: null },
  redditScan: { status: 'ok', data: [], error: null },
  searches: [
    {
      key: 'top-stories', label: 'Top market stories',
      source: { status: 'ok', data: [{ title: 'Chip rebound', url: 'https://wsj.com/a', content: 'Semis bounce back…', publishedDate: '2026-07-20' }], error: null },
    },
    {
      key: 'reddit-wsb', label: 'Reddit r/wallstreetbets',
      source: { status: 'failed', data: null, error: 'Tavily search failed (500)' },
    },
  ],
  failedSourceCount: 1,
};

const rules: RuleContext[] = [
  { ruleNumber: 15, title: 'Chop-day circuit breaker', description: 'Max 3 trades / $300 loss on chop days.' },
];

const validBrief = {
  overview: 'Rebound tape.',
  tradingPosture: 'Let SPY define direction.',
  topStories: [{ headline: 'Chip rebound', summary: 'Semis bounce.', sourceUrl: 'https://wsj.com/a' }],
  earningsNotes: [{ ticker: 'TRV', watchItem: 'Combined ratio' }],
  stocksInPlay: [{ ticker: 'NVDA', catalyst: 'Semi rebound', signal: 'High premarket volume', approach: 'Level-to-level after confirmation.' }],
  redditNotes: [{ ticker: 'NVDA', note: 'Dip-buy debate.' }],
  redditDivergence: 'Retail long semis into a tape that keeps selling them.',
  rulesFocus: [{ ruleNumber: 15, title: 'Chop-day circuit breaker', whyToday: 'Headline tape.' }],
};

describe('selectEarnings', () => {
  const row = (symbol: string, date: string, revenueEstimate: number | null) => ({
    symbol, date, hour: 'bmo', epsEstimate: null, revenueEstimate, epsActual: null, revenueActual: null,
  });

  it("keeps today's reporters when Finnhub returns the week date-descending", () => {
    // Finnhub puts the furthest day first; today's block sits hundreds of rows
    // deep, so a head-slice used to drop it entirely.
    const later = Array.from({ length: 200 }, (_, i) => row(`Z${i}`, '2026-07-24', 1e9));
    const today = [row('MMM', '2026-07-21', 6e9), row('SCHW', '2026-07-21', 5e9)];
    const picked = selectEarnings([...later, ...today], '2026-07-21');
    expect(picked.map((r) => r.symbol)).toEqual(expect.arrayContaining(['MMM', 'SCHW']));
    // today sorts ahead of the later day
    expect(picked[0].date).toBe('2026-07-21');
  });

  it('ranks by revenue estimate within a day and treats null as smallest', () => {
    const picked = selectEarnings(
      [row('SMALL', '2026-07-21', 1e6), row('UNKNOWN', '2026-07-21', null), row('BIG', '2026-07-21', 9e9)],
      '2026-07-21',
    );
    expect(picked.map((r) => r.symbol)).toEqual(['BIG', 'SMALL', 'UNKNOWN']);
  });

  it('ranks by market cap over revenue, surfacing big names revenue buries', () => {
    // Live shape: GM out-earns SCHW on revenue but SCHW is ~2.6x the company.
    const picked = selectEarnings(
      [row('GM', '2026-07-21', 47e9), row('SCHW', '2026-07-21', 6e9)],
      '2026-07-21',
      { marketCaps: new Map([['GM', 68_300], ['SCHW', 178_330]]) },
    );
    expect(picked.map((r) => r.symbol)).toEqual(['SCHW', 'GM']);
  });

  it('puts the trader\'s own tickers ahead of larger companies', () => {
    const picked = selectEarnings(
      [row('MEGA', '2026-07-21', 99e9), row('ALK', '2026-07-21', 3e9)],
      '2026-07-21',
      { marketCaps: new Map([['MEGA', 4_000_000], ['ALK', 5_130]]), tradedTickers: ['alk'] },
    );
    expect(picked.map((r) => r.symbol)).toEqual(['ALK', 'MEGA']);
  });

  it('floats a watchlist name above bigger names so it survives the session cut', () => {
    // RDDT is neither traded nor a mega cap; without the watchlist boost seven
    // larger names would bump it past the 6-per-session limit.
    const big = Array.from({ length: 7 }, (_, i) => ({
      symbol: `BIG${i}`, date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 9e9 - i, epsActual: null, revenueActual: null,
    }));
    const picked = selectEarnings(
      [...big, { symbol: 'RDDT', date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 1 , epsActual: null, revenueActual: null}],
      '2026-07-21',
    );
    expect(picked.map((r) => r.symbol)).toContain('RDDT');
    expect(picked[0].symbol).toBe('RDDT'); // priority floats to the very top
  });

  it('falls back to revenue when a cap is unknown rather than sinking the row', () => {
    const picked = selectEarnings(
      [row('NOCAP_BIG', '2026-07-21', 50e9), row('NOCAP_SMALL', '2026-07-21', 1e6), row('CAPPED', '2026-07-21', 1e6)],
      '2026-07-21',
      { marketCaps: new Map([['CAPPED', 900_000]]) },
    );
    expect(picked.map((r) => r.symbol)).toEqual(['CAPPED', 'NOCAP_BIG', 'NOCAP_SMALL']);
  });

  it('caps each session separately so a busy morning cannot hide the closers', () => {
    const many = (date: string, hour: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        symbol: `${hour}-${i}`, date, hour, epsEstimate: null, revenueEstimate: n - i, epsActual: null, revenueActual: null,
      }));
    const picked = selectEarnings(
      [...many('2026-07-21', 'bmo', 50), ...many('2026-07-21', 'amc', 50)],
      '2026-07-21',
    );
    const count = (hour: string) => picked.filter((r) => r.hour === hour).length;
    expect(count('bmo')).toBe(6);
    expect(count('amc')).toBe(6);
  });

  it('shows every priority name even past the base limit', () => {
    // Seven priority names (traded) in one session — one more than the base 6.
    const traded = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const priorityRows = traded.map((s, i) => ({
      symbol: s, date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 100 - i, epsActual: null, revenueActual: null,
    }));
    const noise = Array.from({ length: 5 }, (_, i) => ({
      symbol: `N${i}`, date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 1000 - i, epsActual: null, revenueActual: null,
    }));
    const picked = selectEarnings([...noise, ...priorityRows], '2026-07-21', { tradedTickers: traded });
    const shown = picked.map((r) => r.symbol);
    for (const p of traded) expect(shown).toContain(p);
    expect(shown.slice(0, traded.length)).toEqual(traded); // and they lead the column
  });

  // Adding QBTS and OSCR to the watchlist quietly cost the column DDOG and WBD:
  // the two highlighted names were being subtracted from the same six slots the
  // ranked reporters compete for. A watchlist name is an addition to the day's
  // notable list, not a substitution for the biggest reporter on it.
  it('does not let a watchlist name push a top-ranked reporter off the column', () => {
    const ranked = Array.from({ length: 6 }, (_, i) => ({
      symbol: `RANK${i}`, date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 9e9 - i, epsActual: null, revenueActual: null,
    }));
    const watched = ['QBTS', 'OSCR'].map((s) => ({
      symbol: s, date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 1, epsActual: null, revenueActual: null,
    }));

    const shown = selectEarnings([...ranked, ...watched], '2026-07-21').map((r) => r.symbol);

    expect(shown).toEqual(['QBTS', 'OSCR', 'RANK0', 'RANK1', 'RANK2', 'RANK3', 'RANK4', 'RANK5']);
  });

  it('keeps undated rows to a short tail so micro caps do not fill the column', () => {
    const undated = Array.from({ length: 20 }, (_, i) => ({
      symbol: `TBD${i}`, date: '2026-07-21', hour: '', epsEstimate: null, revenueEstimate: 20 - i, epsActual: null, revenueActual: null,
    }));
    const picked = selectEarnings(undated, '2026-07-21');
    expect(picked).toHaveLength(2);
  });

  it('orders by session within a day: before open, then after close', () => {
    const picked = selectEarnings(
      [
        { symbol: 'CLOSER', date: '2026-07-21', hour: 'amc', epsEstimate: null, revenueEstimate: 9e9 , epsActual: null, revenueActual: null},
        { symbol: 'OPENER', date: '2026-07-21', hour: 'bmo', epsEstimate: null, revenueEstimate: 1 , epsActual: null, revenueActual: null},
      ],
      '2026-07-21',
    );
    expect(picked.map((r) => r.symbol)).toEqual(['OPENER', 'CLOSER']);
  });

  it('includes the previous trading day and drops anything outside the window', () => {
    // 2026-07-21 is a Tuesday, so Monday the 20th is in-window; the 16th is not.
    const picked = selectEarnings(
      [row('STALE', '2026-07-16', 1e9), row('YESTERDAY', '2026-07-20', 1e9), row('NOW', '2026-07-21', 1e9)],
      '2026-07-21',
    );
    expect(picked.map((r) => r.symbol)).toEqual(['YESTERDAY', 'NOW']);
  });

  it('keeps PLTR on the prior session date when the after-close column is full', () => {
    const largerReporters = Array.from({ length: 6 }, (_, i) => ({
      symbol: `LARGE${i}`,
      date: '2026-08-03',
      hour: 'amc',
      epsEstimate: null,
      revenueEstimate: 10_000_000_000 - i,
      epsActual: null,
      revenueActual: null,
    }));
    const picked = selectEarnings(
      [...largerReporters, {
        symbol: 'PLTR', date: '2026-08-03', hour: 'amc', epsEstimate: 0.3544, revenueEstimate: 1_840_805_587, epsActual: null, revenueActual: null,
      }],
      '2026-08-04',
    );

    expect(picked).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'PLTR', date: '2026-08-03', hour: 'amc' }),
    ]));
  });
});

describe('buildRedditRows', () => {
  const scanItem = {
    ticker: 'HTZ', name: 'Hertz', subreddit: 'wallstreetbets',
    mentions: 675, mentions24hAgo: 6, momentum: 112.5,
    rank: 1, sentiment: 'bullish' as const, sentimentScore: 0.4, inTodaysBrief: false,
  };

  it('carries the real counts through and attaches the model note by ticker', () => {
    const rows = buildRedditRows([scanItem], [{ ticker: 'HTZ', note: 'Rental squeeze chatter.' }]);
    expect(rows).toEqual([{
      ticker: 'HTZ', name: 'Hertz', subreddit: 'wallstreetbets',
      mentions: 675, mentions24hAgo: 6, momentum: 112.5,
      sentiment: 'bullish', sentimentScore: 0.4, inTodaysBrief: false,
      note: 'Rental squeeze chatter.',
    }]);
  });

  it('leaves the note empty for a ticker the model skipped', () => {
    expect(buildRedditRows([scanItem], [])[0].note).toBe('');
  });

  it('matches a note case-insensitively', () => {
    expect(buildRedditRows([scanItem], [{ ticker: ' htz ', note: 'n' }])[0].note).toBe('n');
  });

  // A note for a ticker that is not on the scan is the model inventing a row.
  it('ignores a note for a ticker that is not trending', () => {
    const rows = buildRedditRows([scanItem], [{ ticker: 'NFLX', note: '$30 target' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('HTZ');
  });

  // The prompt forbids figures here and the model keeps writing them anyway:
  // it produced a "$30 price target" for a four-figure stock, then a "breakout
  // above $175" for a name trading in single digits. Every real number is
  // already printed on the row, so a note carrying one is at best redundant and
  // at worst invented — and the trader cannot tell which.
  it('drops a note that invents a price level', () => {
    expect(buildRedditRows([scanItem], [{ ticker: 'HTZ', note: 'Watch for breakout above $175' }])[0].note).toBe('');
  });

  it('drops a note that restates a figure from the row', () => {
    expect(buildRedditRows([scanItem], [{ ticker: 'HTZ', note: 'High mentions (694) on AI chatter' }])[0].note).toBe('');
    expect(buildRedditRows([scanItem], [{ ticker: 'HTZ', note: 'Momentum of 115.7x leads the board' }])[0].note).toBe('');
  });

  it('keeps a purely qualitative note', () => {
    const note = 'Meme-driven chatter around a rental-fleet squeeze.';
    expect(buildRedditRows([scanItem], [{ ticker: 'HTZ', note }])[0].note).toBe(note);
  });
});

describe('buildEarnings', () => {
  const row = (symbol: string, hour: string, epsEstimate: number | null) => ({
    symbol, date: '2026-07-21', hour, epsEstimate, revenueEstimate: null, epsActual: null, revenueActual: null,
  });

  it('builds the list structurally from the calendar, independent of the model', () => {
    const ranked = [row('SCHW', 'bmo', 1.58), row('ALK', 'amc', -1.0)];
    const names = new Map([['SCHW', 'Charles Schwab']]);
    const built = buildEarnings(ranked, names, [{ ticker: 'SCHW', watchItem: 'Net new assets' }]);
    expect(built).toEqual([
      { ticker: 'SCHW', company: 'Charles Schwab', date: '2026-07-21', timing: 'BMO', epsEstimate: '1.58', watchItem: 'Net new assets' },
      { ticker: 'ALK', company: 'ALK', date: '2026-07-21', timing: 'AMC', epsEstimate: '-1', watchItem: '' },
    ]);
  });

  it('falls back to the ticker when no company name is known', () => {
    const built = buildEarnings([row('XYZ', 'bmo', null)], new Map(), []);
    expect(built[0]).toMatchObject({ ticker: 'XYZ', company: 'XYZ', epsEstimate: null, watchItem: '' });
  });

  it('matches watchItems by ticker case-insensitively and ignores notes for absent names', () => {
    const built = buildEarnings([row('GM', 'bmo', 3.29)], new Map(), [
      { ticker: 'gm', watchItem: 'China demand' },
      { ticker: 'AMD', watchItem: 'never listed' },
    ]);
    expect(built).toHaveLength(1);
    expect(built[0].watchItem).toBe('China demand');
  });
});

describe('buildBriefPrompt', () => {
  const ranked = [{ symbol: 'TRV', date: '2026-07-21', hour: 'bmo', epsEstimate: 5.34, revenueEstimate: null , epsActual: null, revenueActual: null}];

  it('includes date, quotes, earnings, rules, and search content; notes failed sources', () => {
    const { system, user } = buildBriefPrompt(gather, rules, '2026-07-20', ranked);
    expect(system).toContain('JSON');
    expect(user).toContain('2026-07-20');
    expect(user).toContain('Chip rebound');
    expect(user).toContain('TRV');
    expect(user).toContain('Travelers Companies'); // company name annotated from profiles
    expect(user).toContain('Chop-day circuit breaker');
    expect(user).toContain('Reddit r/wallstreetbets: UNAVAILABLE');
  });

  it('passes the feed calendar in as context and tells the model not to return one', () => {
    const { system, user } = buildBriefPrompt(gather, rules, '2026-07-20', ranked);
    expect(user).toContain('Import Prices m/m');
    expect(system).not.toContain('"econCalendar"');
  });

  it('asks for 3-5 evidenced picks and names the tickers banned from stocksInPlay', () => {
    const withLate: GatherResult = {
      ...gather,
      earningsCalendar: {
        status: 'ok',
        data: [
          { symbol: 'TRV', date: '2026-07-21', hour: 'bmo', epsEstimate: 5.34, revenueEstimate: null , epsActual: null, revenueActual: null},
          { symbol: 'AAPL', date: '2026-07-20', hour: 'amc', epsEstimate: null, revenueEstimate: null , epsActual: null, revenueActual: null},
        ],
        error: null,
      },
    };
    const { system, user } = buildBriefPrompt(withLate, rules, '2026-07-20', ranked);
    expect(system).toContain('3-5 names');
    expect(user).toContain("Reporting AFTER today's close");
    expect(user).toContain('AAPL');
  });

  // The gap screen is the evidence base for Stocks in Play: every row is a
  // company that has already reported and a move the tape actually made.
  it('puts the gap screen in front of the model with its catalyst and move', () => {
    const withScreen: GatherResult = {
      ...gather,
      gapScreen: {
        status: 'ok',
        error: null,
        data: [{
          ticker: 'DDOG', reportedAt: 'this morning before open',
          gapPct: -18.72, price: 230.23, prevClose: 283.17,
          marketCap: 81_952_710_656, relVolume: 3.1,
          epsEstimate: 0.6019, epsActual: 0.65, surprisePct: 8.0,
        }],
      },
    };
    const { system, user } = buildBriefPrompt(withScreen, rules, '2026-07-20', ranked);
    expect(user).toContain('Already reported');
    expect(user).toContain('DDOG');
    expect(user).toContain('-18.72%');
    expect(user).toContain('230.23');
    expect(system).toContain('gap screen');
  });

  it('says plainly when no one has reported rather than leaving the section absent', () => {
    const { user } = buildBriefPrompt(gather, rules, '2026-07-20', ranked);
    expect(user).toContain('Already reported');
    expect(user).toContain('None');
  });

  it('marks the screen unavailable when Yahoo failed', () => {
    const failed: GatherResult = {
      ...gather,
      gapScreen: { status: 'failed', data: null, error: 'Yahoo quote failed (429)' },
    };
    const { user } = buildBriefPrompt(failed, rules, '2026-07-20', ranked);
    expect(user).toContain('UNAVAILABLE (Yahoo quote failed (429))');
  });

  // The model gets real counts to write from instead of Tavily's Reddit
  // landing pages, which is what it was inventing sentiment from.
  it('puts the mention counts, momentum and direction in front of the model', () => {
    const withScan: GatherResult = {
      ...gather,
      redditScan: {
        status: 'ok',
        error: null,
        data: [{
          ticker: 'HTZ', name: 'Hertz', subreddit: 'wallstreetbets',
          mentions: 675, mentions24hAgo: 6, momentum: 112.5,
          rank: 1, sentiment: 'bullish', sentimentScore: 0.4, inTodaysBrief: false,
        }],
      },
    };
    const { system, user } = buildBriefPrompt(withScan, rules, '2026-07-20', ranked);
    expect(user).toContain('HTZ');
    expect(user).toContain('675');
    expect(user).toContain('112.5x');
    expect(user).toContain('bullish');
    expect(system).toContain('redditNotes');
  });

  it('marks the scan unavailable when the mention feeds failed', () => {
    const failed: GatherResult = {
      ...gather,
      redditScan: { status: 'failed', data: null, error: 'ApeWisdom failed (503)' },
    };
    expect(buildBriefPrompt(failed, rules, '2026-07-20', ranked).user)
      .toContain('UNAVAILABLE (ApeWisdom failed (503))');
  });

  it('puts the live quote table in front of the model as its only price source', () => {
    const { system, user } = buildBriefPrompt(gather, rules, '2026-07-20', ranked);
    expect(user).toContain('NVDA | 180.25 | 3.50% | 174.15 | 176.2-181.4');
    expect(system).toContain('ONLY source of prices');
  });

  it('reports a pre-open candidate as unopened rather than a $0 range', () => {
    const preOpen: GatherResult = {
      ...gather,
      candidateQuotes: new Map([
        ['AMD', { current: 210, change: 2, changePct: 1, prevClose: 208, high: 0, low: 0 }],
      ]),
    };
    expect(buildBriefPrompt(preOpen, rules, '2026-07-20', ranked).user).toContain('AMD | 210 | 1.00% | 208 | not open yet');
  });

  it('tells the model to cite no levels at all when nothing could be priced', () => {
    const unpriced: GatherResult = { ...gather, candidateQuotes: new Map() };
    expect(buildBriefPrompt(unpriced, rules, '2026-07-20', ranked).user).toContain('None priced');
  });

  it('says so plainly when nothing reports after the close', () => {
    expect(buildBriefPrompt(gather, rules, '2026-07-20', ranked).user).toContain('None scheduled.');
  });

  it('marks the econ calendar unavailable rather than dropping the section', () => {
    const failed: GatherResult = {
      ...gather,
      econCalendar: { status: 'failed', data: null, error: 'Economic calendar feed failed (503)' },
    };
    expect(buildBriefPrompt(failed, rules, '2026-07-20', ranked).user).toContain('UNAVAILABLE (Economic calendar feed failed (503))');
  });
});

describe('lateReportersToday', () => {
  const row = (symbol: string, date: string, hour: string) => ({
    symbol, date, hour, epsEstimate: null, revenueEstimate: null, epsActual: null, revenueActual: null,
  });

  it("excludes today's after-close and untimed reporters, but not before-open ones", () => {
    const late = lateReportersToday([
      row('AAPL', '2026-07-30', 'amc'),
      row('TRMB', '2026-07-30', ''),      // Finnhub has not timed it — could be after the bell
      row('MA', '2026-07-30', 'bmo'),     // already reported, news is in the tape
      row('PLTR', '2026-08-03', 'amc'),   // a different session
    ], '2026-07-30');
    expect([...late].sort()).toEqual(['AAPL', 'TRMB']);
  });

  it('is empty when nothing reports today', () => {
    expect(lateReportersToday([row('PLTR', '2026-08-03', 'amc')], '2026-07-30').size).toBe(0);
  });
});

describe('collectSourceLinks', () => {
  it('collects urls from successful searches only', () => {
    expect(collectSourceLinks(gather)).toEqual([{ url: 'https://wsj.com/a', title: 'Chip rebound' }]);
  });
});

describe('synthesizeBrief', () => {
  it('takes the econ calendar from the feed, not the model', async () => {
    const generateFn = vi.fn().mockResolvedValueOnce({ ...validBrief, econCalendar: [{ name: 'Invented CPI' }] });
    const out = await synthesizeBrief({ gather, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn: quoteFetch(), generateFn });
    expect(out.econCalendar).toEqual(ECON);
    expect(out.topStories[0].headline).toBe('Chip rebound');
    // earnings are built deterministically from the calendar, not the model:
    // full name from profiles, EPS from Finnhub, watchItem matched from notes.
    expect(out.earnings).toEqual([
      { ticker: 'TRV', company: 'Travelers Companies', date: '2026-07-21', timing: 'BMO', epsEstimate: '5.34', watchItem: 'Combined ratio' },
    ]);
    expect(generateFn).toHaveBeenCalledTimes(1);
  });

  it("drops a stocksInPlay pick that reports after today's close", async () => {
    const withLate: GatherResult = {
      ...gather,
      earningsCalendar: {
        status: 'ok',
        data: [{ symbol: 'NVDA', date: '2026-07-20', hour: 'amc', epsEstimate: null, revenueEstimate: null , epsActual: null, revenueActual: null}],
        error: null,
      },
    };
    const generateFn = vi.fn().mockResolvedValueOnce({
      ...validBrief,
      stocksInPlay: [
        { ticker: 'NVDA', catalyst: 'Reports tonight', signal: 'Heavy volume', approach: 'Nope.' },
        { ticker: 'AMD', catalyst: 'Upgrade', signal: '3x average volume', approach: 'Reclaim of yesterday high.' },
      ],
    });
    const out = await synthesizeBrief({ gather: withLate, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn: quoteFetch(), generateFn });
    expect(out.stocksInPlay.map((s) => s.ticker)).toEqual(['AMD']);
  });

  it('reuses the prompt\'s candidate quote instead of paying Finnhub twice', async () => {
    const generateFn = vi.fn().mockResolvedValueOnce(validBrief);
    const fetchFn = quoteFetch();
    const out = await synthesizeBrief({ gather, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn, generateFn });
    // NVDA was priced for the prompt table, so the pick carries those numbers
    // and costs no second call.
    expect(out.stocksInPlay[0]).toMatchObject({
      ticker: 'NVDA',
      quote: { price: 180.25, changePct: 3.5, prevClose: 174.15, dayHigh: 181.4, dayLow: 176.2 },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches a quote for a pick the candidate table did not cover', async () => {
    const generateFn = vi.fn().mockResolvedValueOnce({
      ...validBrief,
      stocksInPlay: [{ ticker: 'AMD', catalyst: 'Upgrade', signal: 'Heavy volume', approach: 'Reclaim premarket high.' }],
    });
    const fetchFn = quoteFetch();
    const out = await synthesizeBrief({ gather, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn, generateFn });
    expect(out.stocksInPlay[0]).toMatchObject({
      ticker: 'AMD',
      quote: { price: 100, changePct: 5.25, prevClose: 95 },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries once on a validation failure, then succeeds', async () => {
    const generateFn = vi.fn()
      .mockRejectedValueOnce(new Error('Market brief synthesis did not match the expected schema'))
      .mockResolvedValueOnce(validBrief);
    const out = await synthesizeBrief({ gather, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn: quoteFetch(), generateFn });
    expect(out.overview).toBe('Rebound tape.');
    expect(generateFn).toHaveBeenCalledTimes(2);
    expect(generateFn.mock.calls[1][1]).toContain('previous output was invalid');
  });

  it('throws after two validation failures', async () => {
    const generateFn = vi.fn().mockRejectedValue(new Error('Market brief synthesis returned invalid JSON'));
    await expect(synthesizeBrief({ gather, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn: quoteFetch(), generateFn })).rejects.toThrow(/invalid brief/i);
    expect(generateFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry provider errors (auth/rate-limit/api)', async () => {
    const generateFn = vi.fn().mockRejectedValue(new AiProviderError('Rate limited', 429, 'rate_limit'));
    await expect(synthesizeBrief({ gather, rules, todayPt: '2026-07-20', finnhubKey: 'fk', fetchFn: quoteFetch(), generateFn })).rejects.toThrow('Rate limited');
    expect(generateFn).toHaveBeenCalledTimes(1);
  });
});
