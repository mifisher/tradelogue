const BASE = 'https://finnhub.io/api/v1';

export class FinnhubError extends Error {}

export interface FinnhubQuote {
  current: number;
  change: number;
  changePct: number;
  /** Previous session's close — the level today's gap is measured from. */
  prevClose: number;
  /** Session high/low; 0 before the open. */
  high: number;
  low: number;
}

export interface FinnhubEarning {
  symbol: string;
  date: string;
  hour: string; // 'bmo' | 'amc' | 'dmh' | ''
  epsEstimate: number | null;
  revenueEstimate: number | null;
  /** Populated once the company has actually reported. For a before-open name
   * on the current session this is how the brief knows the news is already out
   * — the single most dateable catalyst the pipeline has access to. */
  epsActual: number | null;
  revenueActual: number | null;
}

interface Opts {
  apiKey: string;
  fetchFn?: typeof fetch;
}

/** Finnhub answers an unknown symbol with 200 and an all-zero body rather than
 * a 404, so a zero `c` is how a bad ticker announces itself. */
async function requestQuote(symbol: string, opts: Opts): Promise<FinnhubQuote | null> {
  const { apiKey, fetchFn = fetch } = opts;
  const res = await fetchFn(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
  if (!res.ok) throw new FinnhubError(`Finnhub quote failed (${res.status})`);
  const body = (await res.json()) as {
    c?: number | null; d?: number | null; dp?: number | null;
    pc?: number | null; h?: number | null; l?: number | null;
  };
  if (!body.c) return null;
  return {
    current: body.c,
    change: body.d ?? 0,
    changePct: body.dp ?? 0,
    prevClose: body.pc ?? 0,
    high: body.h ?? 0,
    low: body.l ?? 0,
  };
}

export async function fetchQuote(symbol: string, opts: Opts): Promise<FinnhubQuote> {
  const quote = await requestQuote(symbol, opts);
  if (!quote) throw new FinnhubError(`Finnhub returned no quote for ${symbol}`);
  return quote;
}

/** Null means "Finnhub has no such US-listed symbol" — the caller may treat
 * that as a fabricated ticker. Transport and API failures still throw, so a
 * flaky request is never mistaken for a bad ticker. */
export async function lookupQuote(symbol: string, opts: Opts): Promise<FinnhubQuote | null> {
  return requestQuote(symbol, opts);
}

export async function fetchEarningsCalendar(from: string, to: string, opts: Opts): Promise<FinnhubEarning[]> {
  const { apiKey, fetchFn = fetch } = opts;
  // A daily calendar is time-sensitive: a cached empty response can make an
  // otherwise successful brief silently omit its reporters.
  const res = await fetchFn(`${BASE}/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`, { cache: 'no-store' });
  if (!res.ok) throw new FinnhubError(`Finnhub earnings calendar failed (${res.status})`);
  const body = (await res.json()) as {
    earningsCalendar?: {
      symbol?: string; date?: string; hour?: string;
      epsEstimate?: number | null; revenueEstimate?: number | null;
      epsActual?: number | null; revenueActual?: number | null;
    }[];
  };
  return (body.earningsCalendar ?? []).map((e) => ({
    symbol: e.symbol ?? '',
    date: e.date ?? '',
    hour: e.hour ?? '',
    epsEstimate: e.epsEstimate ?? null,
    revenueEstimate: e.revenueEstimate ?? null,
    epsActual: e.epsActual ?? null,
    revenueActual: e.revenueActual ?? null,
  }));
}
