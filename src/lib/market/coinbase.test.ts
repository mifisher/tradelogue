import { describe, it, expect, vi } from 'vitest';
import { fetchBtcQuote, CoinbaseError } from './coinbase';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchBtcQuote', () => {
  it('derives the 24h change from open and last', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonRes(200, { open: '64000', last: '66560', high: '66700', low: '63900' }),
    );
    const q = await fetchBtcQuote({ fetchFn });
    expect(q.current).toBe(66560);
    expect(q.change).toBeCloseTo(2560, 5);
    expect(q.changePct).toBeCloseTo(4, 5);
    expect(String(fetchFn.mock.calls[0][0])).toBe(
      'https://api.exchange.coinbase.com/products/BTC-USD/stats',
    );
  });

  it('reports a negative change when price fell', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { open: '70000', last: '66500' }));
    const q = await fetchBtcQuote({ fetchFn });
    expect(q.change).toBeCloseTo(-3500, 5);
    expect(q.changePct).toBeCloseTo(-5, 5);
  });

  it('falls back to a flat change when open is unusable', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { open: null, last: '66560' }));
    expect(await fetchBtcQuote({ fetchFn })).toEqual({ current: 66560, change: 0, changePct: 0 });
  });

  it('throws CoinbaseError when no price comes back', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { open: '64000', last: null }));
    await expect(fetchBtcQuote({ fetchFn })).rejects.toThrow(CoinbaseError);
  });

  it('throws CoinbaseError on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(503, {}));
    await expect(fetchBtcQuote({ fetchFn })).rejects.toThrow('Coinbase BTC stats failed (503)');
  });
});
