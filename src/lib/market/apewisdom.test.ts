import { describe, it, expect, vi } from 'vitest';
import { fetchApeWisdom } from './apewisdom';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const PAGE = {
  count: 796,
  pages: 8,
  current_page: 1,
  results: [
    { rank: 1, ticker: 'HTZ', name: 'Hertz', mentions: 675, upvotes: 3407, rank_24h_ago: 137, mentions_24h_ago: 6 },
    { rank: 2, ticker: 'SNDK', name: 'Sandisk', mentions: 508, upvotes: 2238, rank_24h_ago: 4, mentions_24h_ago: 662 },
  ],
};

describe('fetchApeWisdom', () => {
  it('maps a subreddit page into mention rows', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, PAGE));

    const rows = await fetchApeWisdom('wallstreetbets', { fetchFn });

    expect(rows).toEqual([
      { ticker: 'HTZ', name: 'Hertz', subreddit: 'wallstreetbets', rank: 1, rank24hAgo: 137, mentions: 675, mentions24hAgo: 6, upvotes: 3407 },
      { ticker: 'SNDK', name: 'Sandisk', subreddit: 'wallstreetbets', rank: 2, rank24hAgo: 4, mentions: 508, mentions24hAgo: 662, upvotes: 2238 },
    ]);
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://apewisdom.io/api/v1.0/filter/wallstreetbets/page/1');
  });

  // Company names arrive HTML-escaped ("SPDR S&amp;P 500"), and that ampersand
  // would render literally on the card.
  it('unescapes HTML entities in the company name', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      results: [{ rank: 3, ticker: 'SPY', name: 'SPDR S&amp;P 500 ETF Trust', mentions: 447, upvotes: 1161, rank_24h_ago: 2, mentions_24h_ago: 726 }],
    }));
    const rows = await fetchApeWisdom('wallstreetbets', { fetchFn });
    expect(rows[0].name).toBe('SPDR S&P 500 ETF Trust');
  });

  // A brand-new ticker has no baseline, and treating that as zero would make
  // every first appearance look like an infinite spike.
  it('keeps a missing 24h baseline null rather than zero', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      results: [{ rank: 9, ticker: 'NEW', name: 'New Co', mentions: 40, upvotes: 90 }],
    }));
    const rows = await fetchApeWisdom('wallstreetbets', { fetchFn });
    expect(rows[0].mentions24hAgo).toBeNull();
    expect(rows[0].rank24hAgo).toBeNull();
  });

  it('reads only the first page — the tail is long and irrelevant', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, PAGE));
    await fetchApeWisdom('stocks', { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list for a subreddit with no results', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { count: 0, results: [] }));
    expect(await fetchApeWisdom('stocktwits', { fetchFn })).toEqual([]);
  });

  it('throws ApeWisdomError on a non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(503, {}));
    await expect(fetchApeWisdom('wallstreetbets', { fetchFn })).rejects.toThrow('ApeWisdom failed (503)');
  });

  it('skips a row with no ticker rather than emitting a blank one', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      results: [{ rank: 1, ticker: '', mentions: 5, upvotes: 1 }, { rank: 2, ticker: 'OK', mentions: 4, upvotes: 1 }],
    }));
    const rows = await fetchApeWisdom('wallstreetbets', { fetchFn });
    expect(rows.map((r) => r.ticker)).toEqual(['OK']);
  });
});
