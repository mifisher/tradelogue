/** Tradestie — direction to go with ApeWisdom's volume.
 *
 * ApeWisdom says how loudly r/wallstreetbets is talking about a ticker; this
 * says whether the talk is bullish or bearish, from sentiment-scored comments.
 * Covers r/wallstreetbets only, so a ticker trending on r/stocks or r/options
 * simply carries no direction rather than a fabricated one. */

const URL_ = 'https://tradestie.com/api/v1/apps/reddit';

export class TradestieError extends Error {}

export type RedditSentiment = 'bullish' | 'bearish' | 'mixed';

export interface TradestieEntry {
  sentiment: RedditSentiment;
  score: number;
  comments: number;
}

/** Below this the score is noise, whatever label the feed attaches. Tradestie
 * calls +0.007 "Bullish"; reporting that as conviction would tell the trader
 * the crowd agrees on a name it is merely arguing about. */
const CONVICTION_FLOOR = 0.05;

interface Opts {
  fetchFn?: typeof fetch;
}

interface RawEntry {
  ticker?: string;
  sentiment?: string;
  sentiment_score?: number;
  no_of_comments?: number;
}

function classify(score: number, label: string | undefined): RedditSentiment {
  if (Math.abs(score) < CONVICTION_FLOOR) return 'mixed';
  if (score > 0) return 'bullish';
  if (score < 0) return 'bearish';
  return label?.toLowerCase() === 'bearish' ? 'bearish' : 'mixed';
}

export async function fetchTradestieSentiment(opts: Opts = {}): Promise<Map<string, TradestieEntry>> {
  const { fetchFn = fetch } = opts;
  const res = await fetchFn(URL_);
  if (!res.ok) throw new TradestieError(`Tradestie failed (${res.status})`);

  const body = await res.json();
  const entries = new Map<string, TradestieEntry>();
  if (!Array.isArray(body)) return entries; // feed shape changed; no direction is better than a wrong one

  for (const raw of body as RawEntry[]) {
    const ticker = raw.ticker?.trim().toUpperCase();
    if (!ticker) continue;
    const score = typeof raw.sentiment_score === 'number' ? raw.sentiment_score : 0;
    entries.set(ticker, {
      sentiment: classify(score, raw.sentiment),
      score,
      comments: raw.no_of_comments ?? 0,
    });
  }
  return entries;
}
