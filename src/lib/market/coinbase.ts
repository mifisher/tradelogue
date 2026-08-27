const BASE = 'https://api.exchange.coinbase.com';

export class CoinbaseError extends Error {}

export interface CoinbaseQuote {
  current: number;
  change: number;
  changePct: number;
}

interface Opts {
  fetchFn?: typeof fetch;
}

/** Spot price plus rolling 24h change from Coinbase's keyless public stats
 * endpoint. BTC comes from Coinbase for the same reason index history comes
 * from FRED: Finnhub's free tier gates crypto quotes. `open` is the price 24h
 * ago, so `last - open` is the 24h change rather than a session change. */
export async function fetchBtcQuote(opts: Opts = {}): Promise<CoinbaseQuote> {
  const { fetchFn = fetch } = opts;
  const res = await fetchFn(`${BASE}/products/BTC-USD/stats`);
  if (!res.ok) throw new CoinbaseError(`Coinbase BTC stats failed (${res.status})`);
  const body = (await res.json()) as { open?: string | null; last?: string | null };
  const current = Number(body.last);
  const open = Number(body.open);
  if (!Number.isFinite(current) || current === 0) {
    throw new CoinbaseError('Coinbase returned no BTC price');
  }
  if (!Number.isFinite(open) || open === 0) return { current, change: 0, changePct: 0 };
  const change = current - open;
  return { current, change, changePct: (change / open) * 100 };
}
