import { describe, it, expect, vi } from 'vitest';
import { fetchYahooSession, fetchYahooQuotes, YahooError } from './yahoo';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as Response;
}

function textRes(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: new Headers(headers),
  } as Response;
}

const SESSION = { cookie: 'A3=d=xyz', crumb: 'abc123' };

function quote(over: Record<string, unknown>) {
  return {
    symbol: 'X', marketState: 'REGULAR', regularMarketPrice: 100,
    regularMarketPreviousClose: 100, ...over,
  };
}

describe('fetchYahooSession', () => {
  it('carries the consent cookie into the crumb request', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(textRes(200, '', { 'set-cookie': 'A3=d=xyz; Path=/; Domain=.yahoo.com' }))
      .mockResolvedValueOnce(textRes(200, 'abc123'));

    const session = await fetchYahooSession({ fetchFn });

    expect(session.crumb).toBe('abc123');
    const [, init] = fetchFn.mock.calls[1];
    expect((init.headers as Record<string, string>).Cookie).toBe('A3=d=xyz');
  });

  it('throws YahooError when the crumb endpoint refuses', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(textRes(200, '', { 'set-cookie': 'A3=d=xyz' }))
      .mockResolvedValueOnce(textRes(500, ''));
    await expect(fetchYahooSession({ fetchFn })).rejects.toThrow(YahooError);
  });

  // An empty body is a 200 that still leaves us unable to sign a quote request,
  // so it has to fail here rather than three calls later as an opaque 401.
  it('throws YahooError when the crumb comes back empty', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(textRes(200, '', { 'set-cookie': 'A3=d=xyz' }))
      .mockResolvedValueOnce(textRes(200, '   '));
    await expect(fetchYahooSession({ fetchFn })).rejects.toThrow(YahooError);
  });

  // Yahoo throttles crumb minting per IP. Without a backoff here the whole
  // screen is lost on a transient 429 before a single quote is fetched.
  it('waits out a throttled crumb request', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(textRes(200, '', { 'set-cookie': 'A3=d=xyz' }))
      .mockResolvedValueOnce(textRes(429, ''))
      .mockResolvedValueOnce(textRes(200, 'abc123'));

    const session = await fetchYahooSession({ fetchFn, sleepFn: async (ms) => { sleeps.push(ms); } });

    expect(session.crumb).toBe('abc123');
    expect(sleeps).toEqual([1000]);
  });

  it('does not retry a crumb rejection that is not throttling', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(textRes(200, '', { 'set-cookie': 'A3=d=xyz' }))
      .mockResolvedValue(textRes(403, ''));
    await expect(fetchYahooSession({ fetchFn, sleepFn: async () => {} })).rejects.toThrow('(403)');
    expect(fetchFn).toHaveBeenCalledTimes(2); // cookie + one crumb attempt
  });
});

describe('fetchYahooQuotes', () => {
  it('maps a batch into quotes keyed by symbol', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: {
        result: [
          quote({
            symbol: 'DDOG', regularMarketPrice: 230.23, regularMarketPreviousClose: 283.17,
            regularMarketOpen: 227.45, regularMarketVolume: 13058961,
            averageDailyVolume10Day: 4210410, marketCap: 81952710656,
          }),
        ],
      },
    }));

    const quotes = await fetchYahooQuotes(['DDOG'], { session: SESSION, fetchFn });

    expect(quotes.get('DDOG')).toEqual({
      symbol: 'DDOG',
      name: null,
      price: 230.23,
      prevClose: 283.17,
      open: 227.45,
      changePct: expect.closeTo(-18.695, 2),
      volume: 13058961,
      avgVolume10Day: 4210410,
      marketCap: 81952710656,
      marketState: 'REGULAR',
    });
  });

  // The same call that prices a name also names it, which is what lets the
  // earnings card drop its per-symbol Finnhub profile fan-out.
  it('carries the company name, preferring the long form', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: {
        result: [
          quote({ symbol: 'DDOG', longName: 'Datadog, Inc.', shortName: 'Datadog' }),
          quote({ symbol: 'SHRT', shortName: 'Shorty Co' }),
          quote({ symbol: 'ANON' }),
        ],
      },
    }));

    const quotes = await fetchYahooQuotes(['DDOG', 'SHRT', 'ANON'], { session: SESSION, fetchFn });

    expect(quotes.get('DDOG')!.name).toBe('Datadog, Inc.');
    expect(quotes.get('SHRT')!.name).toBe('Shorty Co');
    expect(quotes.get('ANON')!.name).toBeNull();
  });

  // The brief runs at 5 AM PT. If the screen reads regularMarketPrice then, it
  // ranks yesterday's session and every "gap" it reports is a day stale.
  it('uses the premarket price when the market is in its PRE session', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: {
        result: [
          quote({
            symbol: 'DDOG', marketState: 'PRE',
            regularMarketPrice: 283.17, regularMarketPreviousClose: 283.17,
            preMarketPrice: 232.0,
          }),
        ],
      },
    }));

    const q = await fetchYahooQuotes(['DDOG'], { session: SESSION, fetchFn });

    expect(q.get('DDOG')!.price).toBe(232.0);
    expect(q.get('DDOG')!.changePct).toBeCloseTo(-18.07, 1);
  });

  it('falls back to the regular price when PRE has no premarket trade yet', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: {
        result: [quote({ symbol: 'QUIET', marketState: 'PRE', regularMarketPrice: 50, regularMarketPreviousClose: 48 })],
      },
    }));
    expect((await fetchYahooQuotes(['QUIET'], { session: SESSION, fetchFn })).get('QUIET')!.price).toBe(50);
  });

  it('uses the post-market price after the close', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: {
        result: [quote({ symbol: 'NET', marketState: 'POST', regularMarketPrice: 100, regularMarketPreviousClose: 100, postMarketPrice: 111 })],
      },
    }));
    expect((await fetchYahooQuotes(['NET'], { session: SESSION, fetchFn })).get('NET')!.price).toBe(111);
  });

  it('splits large symbol lists across several requests', async () => {
    const symbols = Array.from({ length: 120 }, (_, i) => `S${i}`);
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { quoteResponse: { result: [] } }));

    await fetchYahooQuotes(symbols, { session: SESSION, fetchFn, chunkSize: 50, sleepFn: async () => {} });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[0][0])).toContain('symbols=S0%2CS1%2C');
  });

  // A full screen is ~9 batches. Fired back to back they trip Yahoo's throttle
  // outright, which costs the whole card, so the batches are spaced.
  it('paces consecutive batches instead of firing them back to back', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { quoteResponse: { result: [] } }));

    await fetchYahooQuotes(Array.from({ length: 120 }, (_, i) => `S${i}`), {
      session: SESSION, fetchFn, chunkSize: 50, sleepFn: async (ms) => { sleeps.push(ms); },
    });

    // Two gaps for three batches — nothing before the first.
    expect(sleeps).toEqual([250, 250]);
  });

  it('does not pace a single batch', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { quoteResponse: { result: [] } }));
    await fetchYahooQuotes(['SPY'], { session: SESSION, fetchFn, sleepFn: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([]);
  });

  it('signs the request with the crumb and cookie', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, { quoteResponse: { result: [] } }));
    await fetchYahooQuotes(['SPY'], { session: SESSION, fetchFn });
    expect(String(fetchFn.mock.calls[0][0])).toContain('crumb=abc123');
    expect((fetchFn.mock.calls[0][1].headers as Record<string, string>).Cookie).toBe('A3=d=xyz');
  });

  // A symbol Yahoo does not know is simply absent from `result`. The screen
  // treats a missing quote as "no evidence", never as a zero gap.
  it('omits symbols the payload does not return', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: { result: [quote({ symbol: 'REAL' })] },
    }));
    const quotes = await fetchYahooQuotes(['REAL', 'NOPE'], { session: SESSION, fetchFn });
    expect(quotes.has('NOPE')).toBe(false);
    expect(quotes.size).toBe(1);
  });

  // Without a previous close there is no gap to measure, and a zero would rank
  // as a -100% mover.
  it('omits a symbol with no previous close', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, {
      quoteResponse: { result: [quote({ symbol: 'NEWIPO', regularMarketPreviousClose: 0 })] },
    }));
    expect((await fetchYahooQuotes(['NEWIPO'], { session: SESSION, fetchFn })).size).toBe(0);
  });

  it('throws YahooError on a non-2xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(401, {}));
    await expect(fetchYahooQuotes(['SPY'], { session: SESSION, fetchFn })).rejects.toThrow('Yahoo quote failed (401)');
  });

  // A 180-name screen is four batched requests. Yahoo throttles bursts, so
  // without a backoff one 429 on chunk three loses the whole screen.
  it('retries a rate-limited chunk and keeps its quotes', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonRes(429, {}))
      .mockResolvedValueOnce(jsonRes(200, { quoteResponse: { result: [quote({ symbol: 'DDOG' })] } }));

    const quotes = await fetchYahooQuotes(['DDOG'], {
      session: SESSION, fetchFn, sleepFn: async (ms) => { sleeps.push(ms); },
    });

    expect(quotes.has('DDOG')).toBe(true);
    expect(sleeps).toEqual([1000]);
  });

  it('backs off further on a repeated rate limit', async () => {
    const sleeps: number[] = [];
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonRes(429, {}))
      .mockResolvedValueOnce(jsonRes(429, {}))
      .mockResolvedValueOnce(jsonRes(200, { quoteResponse: { result: [] } }));

    await fetchYahooQuotes(['SPY'], {
      session: SESSION, fetchFn, sleepFn: async (ms) => { sleeps.push(ms); },
    });

    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up on a rate limit that will not clear', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(429, {}));
    await expect(fetchYahooQuotes(['SPY'], {
      session: SESSION, fetchFn, sleepFn: async () => {},
    })).rejects.toThrow('Yahoo quote failed (429)');
  });

  // Only throttling is worth waiting out — a 401 means the crumb is bad and
  // every retry will fail the same way.
  it('does not retry a non-throttling error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(401, {}));
    await expect(fetchYahooQuotes(['SPY'], {
      session: SESSION, fetchFn, sleepFn: async () => {},
    })).rejects.toThrow('Yahoo quote failed (401)');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map without calling out for an empty symbol list', async () => {
    const fetchFn = vi.fn();
    expect((await fetchYahooQuotes([], { session: SESSION, fetchFn })).size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
