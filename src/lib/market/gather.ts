import { fetchQuote, lookupQuote, fetchEarningsCalendar, type FinnhubEarning, type FinnhubQuote } from './finnhub';
import { scanTickers } from './ticker-scan';
import { earningsWindow } from './brief-time';
import { fetchBtcQuote } from './coinbase';
import { fetchFredCloses, fetchVixCloses } from './history';
import { fetchEconCalendar } from './econ-calendar';
import { tavilySearch, type TavilyResult } from './tavily';
import { fetchYahooSession, fetchYahooQuotes, type YahooQuote } from './yahoo';
import { buildGapScreen, type GapCandidate } from './gap-screen';
import { fetchApeWisdom, type ApeWisdomMention } from './apewisdom';
import { fetchTradestieSentiment } from './tradestie';
import { buildRedditScan, type RedditScanItem } from './reddit-scan';
import type { AssetQuote, BriefQuotes, StoredEconEvent } from './brief-schema';

export interface GatherSource<T> {
  status: 'ok' | 'failed';
  data: T | null;
  error: string | null;
}

export interface SearchBundle {
  key: string;
  label: string;
  source: GatherSource<TavilyResult[]>;
}

export interface GatherResult {
  quotes: GatherSource<BriefQuotes>;
  earningsCalendar: GatherSource<FinnhubEarning[]>;
  /** This week's US releases, straight from the ForexFactory feed. */
  econCalendar: GatherSource<StoredEconEvent[]>;
  /** symbol → market cap (millions USD) for today's ranking candidates. */
  marketCaps: Map<string, number>;
  /** symbol → full company name, for the deterministic earnings list. */
  companyNames: Map<string, string>;
  /** Live quotes for the tickers appearing in today's news — the model's only
   * source of real prices when it writes stocksInPlay levels. */
  candidateQuotes: Map<string, FinnhubQuote>;
  /** Companies that have already reported into this session, ranked by how far
   * they gapped — the evidence base for stocksInPlay. */
  gapScreen: GatherSource<GapCandidate[]>;
  /** Tickers retail is talking about, with volume, 24h momentum and direction. */
  redditScan: GatherSource<RedditScanItem[]>;
  searches: SearchBundle[];
  failedSourceCount: number;
}

interface GatherOptions {
  finnhubKey: string;
  tavilyKey: string;
  todayPt: string; // YYYY-MM-DD
  /** Optional override for the earnings calendar range; defaults to the
   * five-session window around today (see earningsWindow). */
  earningsRange?: { from: string; to: string };
  fetchFn?: typeof fetch;
}

const CAP_FETCH_CONCURRENCY = 6;

/** Tickers scanned out of the news and priced for the prompt. Kept small on
 * purpose: Finnhub's free tier allows 60 calls/minute. */
const QUOTE_CANDIDATE_LIMIT = 10;
/** Reddit threads are a ticker soup of memes and cashtags; the catalyst and
 * mover searches are where a priced, news-driven name actually comes from. */
const TICKER_SCAN_SKIP = /^reddit-/;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface GatheredProfiles {
  /** symbol → market cap in USD; missing means "unknown", not "small". Only
   * ever compared between symbols, so the unit matters less than the ordering. */
  marketCaps: Map<string, number>;
  /** symbol → full company name; missing means the earnings list falls back to
   * the ticker. */
  companyNames: Map<string, string>;
}

/** Price and name every company in the earnings window, in one batched pass.
 *
 * This used to be a per-symbol Finnhub `profile2` fan-out, and because that tier
 * allows 60 calls a minute it could only afford the top 45 of *today's* rows by
 * revenue estimate. Two bugs fell out of that budget. Revenue is a poor proxy
 * for size — DDOG is an $82B company that ranks 68th by quarterly revenue on a
 * busy day, so it never got a cap, sorted as zero, and dropped off a card it
 * should have led. And the four non-today sessions were never priced at all, so
 * they ranked on revenue alone.
 *
 * Yahoo answers 50 symbols per request and returns the cap and the name
 * together, so the whole window costs ~30 calls instead of ~1500 and the
 * pre-filter can go away entirely. The same quote map also backs the gap
 * screen, so the two never disagree about a price. */
export async function gatherWindowQuotes(
  rows: FinnhubEarning[],
  opts: { fetchFn: typeof fetch },
): Promise<Map<string, YahooQuote>> {
  // A symbol reporting twice inside the window is still one lookup.
  const symbols = [...new Set(rows.map((r) => r.symbol.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) return new Map();

  const session = await fetchYahooSession({ fetchFn: opts.fetchFn });
  return fetchYahooQuotes(symbols, { session, fetchFn: opts.fetchFn });
}

/** Split the window quotes into the two shapes the earnings card needs. A quote
 * missing either field yields no entry for it: selectEarnings reads an absent
 * cap as zero and falls back to revenue, and buildEarnings falls back to the
 * ticker, which is what we want over a fabricated placeholder. */
export function profilesFromQuotes(quotes: Map<string, YahooQuote>): GatheredProfiles {
  const marketCaps = new Map<string, number>();
  const companyNames = new Map<string, string>();
  for (const [symbol, quote] of quotes) {
    if (quote.marketCap != null && quote.marketCap > 0) marketCaps.set(symbol, quote.marketCap);
    if (quote.name) companyNames.set(symbol, quote.name);
  }
  return { marketCaps, companyNames };
}

/** Price the tickers today's news is actually talking about, so the model has
 * real numbers to write levels from instead of inventing them. Best-effort per
 * symbol: an unknown ticker yields no entry (the scan is deliberately loose),
 * and a failed call costs one candidate rather than the brief. */
export async function gatherCandidateQuotes(
  searches: SearchBundle[],
  opts: { finnhubKey: string; fetchFn: typeof fetch; limit?: number },
): Promise<Map<string, FinnhubQuote>> {
  const texts: string[] = [];
  for (const bundle of searches) {
    if (TICKER_SCAN_SKIP.test(bundle.key)) continue;
    if (bundle.source.status !== 'ok' || !bundle.source.data) continue;
    for (const result of bundle.source.data) texts.push(`${result.title}\n${result.content}`);
  }

  const symbols = scanTickers(texts, { limit: opts.limit ?? QUOTE_CANDIDATE_LIMIT });
  const quotes = new Map<string, FinnhubQuote>();
  await mapWithConcurrency(symbols, CAP_FETCH_CONCURRENCY, async (symbol) => {
    try {
      const quote = await lookupQuote(symbol, { apiKey: opts.finnhubKey, fetchFn: opts.fetchFn });
      if (quote) quotes.set(symbol, quote);
    } catch {
      // one unpriced candidate, not a failed brief
    }
  });
  return quotes;
}

/** Subreddits the trader reads, in the aggregator's naming. r/StockMarket has
 * no separate feed; its traffic largely overlaps these four. */
const REDDIT_SUBS = ['wallstreetbets', 'stocks', 'investing', 'options'];

/** What retail is loud about this morning, with direction where it exists.
 *
 * Sentiment is best-effort on top of mention volume: Tradestie covers
 * r/wallstreetbets only, so a failure there costs the arrows and not the
 * section. Subreddits are likewise independent — three of four can be down and
 * the fourth still carries a usable scan. Only a total blackout throws. */
export async function gatherRedditScan(
  briefTickers: Set<string>,
  opts: { fetchFn: typeof fetch },
): Promise<RedditScanItem[]> {
  const [sentiment, ...perSub] = await Promise.allSettled([
    fetchTradestieSentiment({ fetchFn: opts.fetchFn }),
    ...REDDIT_SUBS.map((s) => fetchApeWisdom(s, { fetchFn: opts.fetchFn })),
  ]);

  const mentions: ApeWisdomMention[] = [];
  let reached = 0;
  for (const result of perSub) {
    if (result.status !== 'fulfilled') continue;
    reached++;
    mentions.push(...result.value);
  }
  if (reached === 0) {
    const reason = perSub.find((r) => r.status === 'rejected');
    throw new Error(
      `No Reddit mention data: ${reason?.status === 'rejected' ? String(reason.reason) : 'unknown'}`,
    );
  }

  return buildRedditScan(
    mentions,
    sentiment.status === 'fulfilled' ? sentiment.value : new Map(),
    { briefTickers },
  );
}

async function wrap<T>(p: Promise<T>): Promise<GatherSource<T>> {
  try {
    return { status: 'ok', data: await p, error: null };
  } catch (err) {
    return { status: 'failed', data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const SEARCHES: { key: string; label: string; query: (today: string) => string; topic: 'news' | 'general'; days?: number; maxResults?: number; includeDomains?: string[] }[] = [
  { key: 'top-stories', label: 'Top market stories', query: (t) => `top US stock market news premarket ${t}`, topic: 'news', days: 1 },
  { key: 'premarket-movers', label: 'Premarket movers / stocks in play', query: (t) => `premarket movers biggest stock gainers losers unusual volume gap up gap down ${t}`, topic: 'news', days: 1 },
  { key: 'earnings-news', label: 'Earnings in focus', query: (t) => `major market moving earnings reports this week ${t}`, topic: 'news', days: 2 },
  // stocksInPlay lives or dies on catalyst coverage: "premarket movers" lists
  // what moved but rarely says why, and a name without a dateable reason is one
  // the brief has to drop.
  { key: 'catalyst-ratings', label: 'Analyst upgrades / downgrades / price targets', query: (t) => `stock analyst upgrade downgrade price target raised cut ${t}`, topic: 'news', days: 1, maxResults: 5 },
  { key: 'catalyst-corporate', label: 'Corporate catalysts (FDA, M&A, restructuring, guidance)', query: (t) => `stock surges plunges FDA approval merger acquisition restructuring layoffs guidance raised buyback ${t}`, topic: 'news', days: 2, maxResults: 5 },
  // No Reddit searches here on purpose. Tavily does not index Reddit comment
  // bodies, so `site:reddit.com` queries returned subreddit landing pages,
  // "Prove your humanity" bot walls and threads years old — which is what the
  // model was inventing sentiment from. Real mention counts now come from the
  // aggregators in gatherRedditScan.
];

async function gatherQuotes(finnhubKey: string, fetchFn: typeof fetch): Promise<BriefQuotes> {
  const [spyQ, qqqQ, spyHist, qqqHist, vixHist, btcQ] = await Promise.allSettled([
    fetchQuote('SPY', { apiKey: finnhubKey, fetchFn }),
    fetchQuote('QQQ', { apiKey: finnhubKey, fetchFn }),
    fetchFredCloses('SP500', { fetchFn }),
    fetchFredCloses('NASDAQ100', { fetchFn }),
    fetchVixCloses({ fetchFn }),
    fetchBtcQuote({ fetchFn }),
  ]);

  const spark = (r: PromiseSettledResult<{ date: string; close: number }[]>) =>
    r.status === 'fulfilled' ? r.value.map((c) => c.close) : [];

  const assets: AssetQuote[] = [];
  if (spyQ.status === 'fulfilled') {
    assets.push({ symbol: 'SPY', label: 'S&P 500 (SPY)', value: spyQ.value.current, change: spyQ.value.change, changePct: spyQ.value.changePct, sparkline: spark(spyHist) });
  }
  if (qqqQ.status === 'fulfilled') {
    assets.push({ symbol: 'QQQ', label: 'NASDAQ (QQQ)', value: qqqQ.value.current, change: qqqQ.value.change, changePct: qqqQ.value.changePct, sparkline: spark(qqqHist) });
  }
  const vix = spark(vixHist);
  if (vix.length >= 2) {
    const last = vix[vix.length - 1];
    const prev = vix[vix.length - 2];
    assets.push({
      symbol: 'VIX', label: 'VIX (close)', value: last, change: last - prev,
      changePct: prev !== 0 ? ((last - prev) / prev) * 100 : 0, sparkline: vix,
    });
  }
  if (btcQ.status === 'fulfilled') {
    assets.push({
      symbol: 'BTC', label: 'Bitcoin (BTC)', value: btcQ.value.current,
      change: btcQ.value.change, changePct: btcQ.value.changePct, sparkline: [],
    });
  }
  if (assets.length === 0) {
    const reasons = [spyQ, qqqQ, vixHist, btcQ]
      .map((r) => (r.status === 'rejected' ? String(r.reason) : null))
      .filter(Boolean)
      .join('; ');
    throw new Error(`No asset quotes available: ${reasons}`);
  }
  return { assets, asOfUtc: new Date().toISOString() };
}

export async function gatherAll(opts: GatherOptions): Promise<GatherResult> {
  const { finnhubKey, tavilyKey, todayPt, earningsRange, fetchFn = fetch } = opts;
  const window = earningsWindow(todayPt);
  const range = earningsRange ?? { from: window[0], to: window[window.length - 1] };

  const [quotes, earningsCalendar, econCalendar, ...searchSources] = await Promise.all([
    wrap(gatherQuotes(finnhubKey, fetchFn)),
    wrap(fetchEarningsCalendar(range.from, range.to, { apiKey: finnhubKey, fetchFn })),
    wrap(fetchEconCalendar({ fetchFn })),
    ...SEARCHES.map((s) =>
      wrap(tavilySearch(s.query(todayPt), {
        apiKey: tavilyKey, fetchFn, maxResults: s.maxResults ?? 6, topic: s.topic, days: s.days, includeDomains: s.includeDomains,
      })),
    ),
  ]);

  const searches: SearchBundle[] = SEARCHES.map((s, i) => ({
    key: s.key,
    label: s.label,
    source: searchSources[i] as GatherSource<TavilyResult[]>,
  }));

  const failedSourceCount =
    (quotes.status === 'failed' ? 1 : 0) +
    (earningsCalendar.status === 'failed' ? 1 : 0) +
    (econCalendar.status === 'failed' ? 1 : 0) +
    searches.filter((s) => s.source.status === 'failed').length;

  const candidateQuotes = await gatherCandidateQuotes(searches, { finnhubKey, fetchFn });

  // Depends on the calendar, so it runs after the batch above rather than in it.
  // Hits Yahoo rather than Finnhub, so it does not compete with the calls above
  // for that tier's 60-calls-per-minute ceiling.
  const windowQuotes = await wrap(
    gatherWindowQuotes(earningsCalendar.data ?? [], { fetchFn }),
  );
  const priced = windowQuotes.data ?? new Map<string, YahooQuote>();

  // Both derive from the one pass, so the card's ranking and the screen's gaps
  // can never be computed off different prices.
  const profiles = profilesFromQuotes(priced);
  const gapScreen: GatherSource<GapCandidate[]> =
    windowQuotes.status === 'ok'
      ? { status: 'ok', data: buildGapScreen(earningsCalendar.data ?? [], priced, todayPt), error: null }
      : { status: 'failed', data: null, error: windowQuotes.error };

  // "Already on the brief" means the names the trader is looking at anyway:
  // today's reporters and whatever gapped on them. That overlap is where retail
  // positioning can actually be checked against the tape.
  const briefTickers = new Set<string>(gapScreen.data?.map((c) => c.ticker) ?? []);
  for (const row of earningsCalendar.data ?? []) {
    if (row.date === todayPt && row.symbol) briefTickers.add(row.symbol.trim().toUpperCase());
  }
  const redditScan = await wrap(gatherRedditScan(briefTickers, { fetchFn }));

  return {
    quotes,
    earningsCalendar,
    econCalendar,
    marketCaps: profiles.marketCaps,
    companyNames: profiles.companyNames,
    candidateQuotes,
    gapScreen,
    redditScan,
    searches,
    failedSourceCount:
      failedSourceCount +
      (windowQuotes.status === 'failed' ? 1 : 0) +
      (redditScan.status === 'failed' ? 1 : 0),
  };
}
