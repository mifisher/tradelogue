/** Yahoo's quote endpoint, used for the morning gap screen.
 *
 * Why Yahoo and not Finnhub, which the rest of the brief runs on: the screen
 * has to price every company that reported before the open — around 180 names
 * on a busy day — and rank them by gap. Finnhub's free tier is one symbol per
 * call against a 60-per-minute ceiling, and its quote carries no volume, no
 * average volume and no market cap, so each name would cost a second profile
 * call to tell a real mover from a microcap. Yahoo answers the whole list in
 * one request with all four fields attached.
 *
 * The cost is that this is an undocumented endpoint: it needs a cookie plus a
 * "crumb" token, and Yahoo can change it without notice. Everything here fails
 * loudly (YahooError) rather than silently returning nothing, so a break shows
 * up as a failed source in the brief instead of an empty Stocks in Play card.
 */

const QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const COOKIE_URL = 'https://fc.yahoo.com';

/** Yahoo 401s a client that sends no User-Agent at all, so one is required —
 * but keep it exactly this generic. A full desktop Chrome string arriving
 * without the TLS fingerprint and sec-ch-ua headers a real Chrome would also
 * send gets flagged, and Yahoo answers 429 on the first request. Measured
 * against the live endpoint: this string returns 200 on an 80-symbol batch
 * where `Mozilla/5.0 (Macintosh…) Chrome/124.0 Safari/537.36` returns 429 for
 * the same cookie, crumb and symbols. Do not "improve" this into a realistic
 * browser UA. */
const USER_AGENT = 'Mozilla/5.0';

/** Yahoo truncates very long symbol lists; 50 per request is comfortably under
 * the limit and keeps a 180-name screen to four calls. */
const DEFAULT_CHUNK_SIZE = 50;

export class YahooError extends Error {}

export interface YahooSession {
  cookie: string;
  crumb: string;
}

export interface YahooQuote {
  symbol: string;
  /** Full company name for display, null when Yahoo has none. Arrives on the
   * same call as the price, which is what lets the earnings card rank and
   * label itself without a per-symbol profile lookup. */
  name: string | null;
  /** The price the gap is measured to: premarket during PRE, post-market
   * during POST, otherwise the regular-session last. */
  price: number;
  prevClose: number;
  /** Regular-session open — null before the bell, which is exactly when the
   * brief runs, so the screen cannot depend on it. */
  open: number | null;
  /** Gap from prevClose to price, in percent. */
  changePct: number;
  volume: number | null;
  avgVolume10Day: number | null;
  marketCap: number | null;
  /** 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | 'POSTPOST' | 'PREPRE' */
  marketState: string;
}

interface SessionOptions {
  fetchFn?: typeof fetch;
  /** Injected so the backoff tests do not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Acquire the cookie/crumb pair that signs a quote request. One round trip for
 * the consent cookie, one to mint the crumb against it.
 *
 * Crumb minting is throttled per IP, and a 429 here costs the entire screen
 * before a single quote is fetched, so it gets the same backoff as the quote
 * calls. */
export async function fetchYahooSession(opts: SessionOptions = {}): Promise<YahooSession> {
  const {
    fetchFn = fetch,
    sleepFn = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  const cookieRes = await fetchFn(COOKIE_URL, { headers: { 'User-Agent': USER_AGENT } });
  // fc.yahoo.com answers 404 while still setting the cookie we need, so the
  // status is deliberately not checked here — only the header matters.
  const cookie = firstCookie(cookieRes.headers.get('set-cookie'));
  if (!cookie) throw new YahooError('Yahoo did not return a session cookie');

  for (let attempt = 0; ; attempt++) {
    const crumbRes = await fetchFn(CRUMB_URL, {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookie },
    });

    if (crumbRes.ok) {
      const crumb = (await crumbRes.text()).trim();
      // A blank 200 means the cookie was not accepted. Failing now beats
      // signing every later request with an empty crumb and reading back an
      // opaque 401.
      if (!crumb) throw new YahooError('Yahoo returned an empty crumb');
      return { cookie, crumb };
    }

    if (crumbRes.status !== 429 || attempt >= RETRY_BACKOFF_MS.length) {
      throw new YahooError(`Yahoo crumb request failed (${crumbRes.status})`);
    }
    await sleepFn(RETRY_BACKOFF_MS[attempt]);
  }
}

/** `set-cookie` may arrive as several comma-joined cookies; the first name=value
 * pair is the session cookie and the attributes after it are noise. */
function firstCookie(header: string | null): string | null {
  if (!header) return null;
  const value = header.split(';')[0].trim();
  return value.includes('=') ? value : null;
}

/** Yahoo throttles bursts, and a full screen is several batched requests, so a
 * 429 partway through would otherwise cost the entire card. */
const RETRY_BACKOFF_MS = [1000, 2000];

/** Gap between consecutive batches. A full screen is around nine of them, and
 * fired back to back they draw a 429 even from a cold IP — measured against the
 * live endpoint. Nine batches spaced this way add ~2s to a job that runs once a
 * morning, which is a good trade for not losing the card. */
const CHUNK_SPACING_MS = 250;

interface QuoteOptions {
  session: YahooSession;
  fetchFn?: typeof fetch;
  chunkSize?: number;
  /** Injected so the backoff tests do not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
}

interface RawQuote {
  symbol?: string;
  longName?: string | null;
  shortName?: string | null;
  marketState?: string;
  regularMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketOpen?: number | null;
  regularMarketVolume?: number | null;
  preMarketPrice?: number | null;
  postMarketPrice?: number | null;
  averageDailyVolume10Day?: number | null;
  marketCap?: number | null;
}

/** Price the whole list. Symbols Yahoo does not return — and symbols with no
 * previous close, which have no gap to measure — are simply absent from the
 * map, so a caller reads a miss as "no evidence" rather than a flat 0%. */
export async function fetchYahooQuotes(
  symbols: string[],
  opts: QuoteOptions,
): Promise<Map<string, YahooQuote>> {
  const {
    session, fetchFn = fetch, chunkSize = DEFAULT_CHUNK_SIZE,
    sleepFn = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = opts;
  const quotes = new Map<string, YahooQuote>();
  if (symbols.length === 0) return quotes;

  for (let i = 0; i < symbols.length; i += chunkSize) {
    if (i > 0) await sleepFn(CHUNK_SPACING_MS);

    const chunk = symbols.slice(i, i + chunkSize);
    const url = `${QUOTE_URL}?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(session.crumb)}`;

    const body = await requestChunk(url, session, fetchFn, sleepFn);
    for (const raw of body.quoteResponse?.result ?? []) {
      const quote = toQuote(raw);
      if (quote) quotes.set(quote.symbol, quote);
    }
  }

  return quotes;
}

/** One batch, waiting out a throttle. Only 429 is retried — a 401 means the
 * crumb is stale and every attempt fails identically. */
async function requestChunk(
  url: string,
  session: YahooSession,
  fetchFn: typeof fetch,
  sleepFn: (ms: number) => Promise<void>,
): Promise<{ quoteResponse?: { result?: RawQuote[] } }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': USER_AGENT, Cookie: session.cookie },
    });
    if (res.ok) return res.json() as Promise<{ quoteResponse?: { result?: RawQuote[] } }>;
    if (res.status !== 429 || attempt >= RETRY_BACKOFF_MS.length) {
      throw new YahooError(`Yahoo quote failed (${res.status})`);
    }
    await sleepFn(RETRY_BACKOFF_MS[attempt]);
  }
}

function toQuote(raw: RawQuote): YahooQuote | null {
  const symbol = raw.symbol?.trim().toUpperCase();
  const prevClose = raw.regularMarketPreviousClose;
  if (!symbol || !prevClose) return null;

  const marketState = raw.marketState ?? 'REGULAR';
  const price = sessionPrice(raw, marketState);
  if (!price) return null;

  return {
    symbol,
    name: firstNonEmpty(raw.longName, raw.shortName),
    price,
    prevClose,
    open: raw.regularMarketOpen ?? null,
    changePct: ((price - prevClose) / prevClose) * 100,
    volume: raw.regularMarketVolume ?? null,
    avgVolume10Day: raw.averageDailyVolume10Day ?? null,
    marketCap: raw.marketCap ?? null,
    marketState,
  };
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** The brief runs premarket, so reading regularMarketPrice would rank
 * yesterday's session. Extended-hours prices are only present once a name has
 * actually traded in that window — a quiet symbol falls back to the regular
 * last, which is still its true reference price. */
function sessionPrice(raw: RawQuote, marketState: string): number | null {
  if (marketState.startsWith('PRE') && raw.preMarketPrice) return raw.preMarketPrice;
  if (marketState.startsWith('POST') && raw.postMarketPrice) return raw.postMarketPrice;
  return raw.regularMarketPrice ?? null;
}
