import { describe, it, expect, vi } from 'vitest';
import { fetchTradestieSentiment, TradestieError } from './tradestie';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchTradestieSentiment', () => {
  it('keys sentiment by ticker', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, [
      { ticker: 'AI', sentiment: 'Bullish', sentiment_score: 0.205, no_of_comments: 78 },
      { ticker: 'SPY', sentiment: 'Bearish', sentiment_score: -0.31, no_of_comments: 42 },
    ]));

    const map = await fetchTradestieSentiment({ fetchFn });

    expect(map.get('AI')).toEqual({ sentiment: 'bullish', score: 0.205, comments: 78 });
    expect(map.get('SPY')).toEqual({ sentiment: 'bearish', score: -0.31, comments: 42 });
  });

  // A score this close to zero is noise dressed as conviction — the trader
  // should read it as a crowded ticker with no directional agreement.
  it('reports a near-zero score as mixed whatever the label claims', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, [
      { ticker: 'SPCX', sentiment: 'Bullish', sentiment_score: 0.007, no_of_comments: 59 },
    ]));
    expect((await fetchTradestieSentiment({ fetchFn })).get('SPCX')!.sentiment).toBe('mixed');
  });

  it('normalises the ticker so it joins against the mention rows', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, [
      { ticker: ' amd ', sentiment: 'Bullish', sentiment_score: 0.4, no_of_comments: 10 },
    ]));
    expect((await fetchTradestieSentiment({ fetchFn })).has('AMD')).toBe(true);
  });

  it('throws TradestieError on a non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(500, {}));
    await expect(fetchTradestieSentiment({ fetchFn })).rejects.toThrow(TradestieError);
  });

  it('tolerates an unexpected body shape', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { error: 'nope' }));
    expect((await fetchTradestieSentiment({ fetchFn })).size).toBe(0);
  });
});
