import { describe, it, expect } from 'vitest';
import { buildRedditScan } from './reddit-scan';
import type { ApeWisdomMention } from './apewisdom';
import type { TradestieEntry } from './tradestie';

function mention(over: Partial<ApeWisdomMention> & { ticker: string }): ApeWisdomMention {
  return {
    name: null, subreddit: 'wallstreetbets', rank: 1, rank24hAgo: 1,
    mentions: 100, mentions24hAgo: 100, upvotes: 500, ...over,
  };
}

const sentiment = (entries: Record<string, TradestieEntry>) =>
  new Map(Object.entries(entries));

describe('buildRedditScan', () => {
  it('measures momentum against the 24h baseline', () => {
    const scan = buildRedditScan(
      [mention({ ticker: 'HTZ', mentions: 675, mentions24hAgo: 6 })],
      new Map(),
      { briefTickers: new Set() },
    );
    expect(scan[0].momentum).toBeCloseTo(112.5, 1);
  });

  // A ticker's first appearance has no baseline. Treating that as zero makes
  // every newcomer an infinite spike and buries the real ones.
  it('leaves momentum null when there is no baseline to compare against', () => {
    const scan = buildRedditScan(
      [mention({ ticker: 'NEW', mentions: 80, mentions24hAgo: null })],
      new Map(),
      { briefTickers: new Set() },
    );
    expect(scan[0].momentum).toBeNull();
  });

  it('treats a zero baseline as no baseline rather than dividing by it', () => {
    const scan = buildRedditScan(
      [mention({ ticker: 'ZERO', mentions: 80, mentions24hAgo: 0 })],
      new Map(),
      { briefTickers: new Set() },
    );
    expect(scan[0].momentum).toBeNull();
  });

  it('joins Tradestie direction onto the mention row', () => {
    const scan = buildRedditScan(
      [mention({ ticker: 'AMD' })],
      sentiment({ AMD: { sentiment: 'bullish', score: 0.205, comments: 78 } }),
      { briefTickers: new Set() },
    );
    expect(scan[0].sentiment).toBe('bullish');
    expect(scan[0].sentimentScore).toBeCloseTo(0.205, 3);
  });

  // Tradestie covers r/wallstreetbets only, so a name trending on r/stocks
  // carries no direction — which must read as unknown, not neutral.
  it('leaves sentiment null for a ticker the sentiment feed does not cover', () => {
    const scan = buildRedditScan(
      [mention({ ticker: 'VOO', subreddit: 'stocks' })],
      new Map(),
      { briefTickers: new Set() },
    );
    expect(scan[0].sentiment).toBeNull();
  });

  it('sums a ticker across subreddits and credits the loudest one', () => {
    const scan = buildRedditScan(
      [
        mention({ ticker: 'NVDA', subreddit: 'stocks', mentions: 40, mentions24hAgo: 20 }),
        mention({ ticker: 'NVDA', subreddit: 'wallstreetbets', mentions: 90, mentions24hAgo: 30 }),
      ],
      new Map(),
      { briefTickers: new Set() },
    );
    expect(scan).toHaveLength(1);
    expect(scan[0].mentions).toBe(130);
    expect(scan[0].subreddit).toBe('wallstreetbets');
    expect(scan[0].momentum).toBeCloseTo(130 / 50, 3);
  });

  it('drops tickers too quiet to mean anything', () => {
    const scan = buildRedditScan(
      [mention({ ticker: 'LOUD', mentions: 200 }), mention({ ticker: 'QUIET', mentions: 2 })],
      new Map(),
      { briefTickers: new Set(), minMentions: 25 },
    );
    expect(scan.map((s) => s.ticker)).toEqual(['LOUD']);
  });

  // The highest-value row in this section is a name the trader is already
  // looking at for other reasons — that is where retail and the tape can
  // actually disagree.
  it('flags and leads with tickers that are already in today brief', () => {
    const scan = buildRedditScan(
      [
        mention({ ticker: 'HTZ', mentions: 675, mentions24hAgo: 6 }),
        mention({ ticker: 'DDOG', mentions: 40, mentions24hAgo: 38 }),
      ],
      new Map(),
      { briefTickers: new Set(['DDOG']) },
    );
    expect(scan[0].ticker).toBe('DDOG');
    expect(scan[0].inTodaysBrief).toBe(true);
    expect(scan[1].inTodaysBrief).toBe(false);
  });

  it('ranks the rest by momentum so a spike beats a permanently crowded ticker', () => {
    const scan = buildRedditScan(
      [
        mention({ ticker: 'SPY', mentions: 447, mentions24hAgo: 726 }),
        mention({ ticker: 'HTZ', mentions: 675, mentions24hAgo: 6 }),
      ],
      new Map(),
      { briefTickers: new Set() },
    );
    expect(scan.map((s) => s.ticker)).toEqual(['HTZ', 'SPY']);
  });

  // Otherwise a heavy overlap day fills every slot with brief names and the
  // section stops reporting what retail found on its own. Overlaps beyond the
  // reserved lead slots still compete for what is left — a brief ticker with a
  // real spike should not be dropped for being the fifth one.
  it('reserves lead slots for overlaps but still lets a retail-only spike in', () => {
    const overlaps = ['A', 'B', 'C', 'D', 'E', 'F'].map((t) => mention({ ticker: t, mentions: 50 }));
    const spike = mention({ ticker: 'HTZ', mentions: 675, mentions24hAgo: 6 });
    const scan = buildRedditScan(
      [...overlaps, spike],
      new Map(),
      { briefTickers: new Set(['A', 'B', 'C', 'D', 'E', 'F']), maxBriefOverlap: 4, limit: 6 },
    );
    expect(scan.slice(0, 4).every((s) => s.inTodaysBrief)).toBe(true);
    expect(scan[4].ticker).toBe('HTZ'); // outranks the leftover overlaps on momentum
  });

  it('caps the scan at the requested size', () => {
    const rows = Array.from({ length: 20 }, (_, i) => mention({ ticker: `T${i}`, mentions: 100 - i }));
    expect(buildRedditScan(rows, new Map(), { briefTickers: new Set(), limit: 6 })).toHaveLength(6);
  });
});
