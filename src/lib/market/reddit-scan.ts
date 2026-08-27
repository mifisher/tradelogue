import type { ApeWisdomMention } from './apewisdom';
import type { TradestieEntry, RedditSentiment } from './tradestie';

/** Merge mention volume with sentiment direction into the rows the Reddit
 * section is written from.
 *
 * The ordering encodes what is actually worth a bullet. A ticker the trader is
 * already looking at today leads, because that is the only place retail
 * positioning and the tape can be compared — everything else is a crowd report.
 * After that, momentum beats raw volume: SPY is mentioned hundreds of times
 * every single day and means nothing, while a name going from 6 mentions to 675
 * overnight is the event. */

export interface RedditScanItem {
  ticker: string;
  name: string | null;
  /** The subreddit talking about it most. */
  subreddit: string;
  mentions: number;
  mentions24hAgo: number | null;
  /** mentions ÷ yesterday's mentions; null when there is no baseline. */
  momentum: number | null;
  /** Best (lowest) rank across the subreddits it appears in. */
  rank: number;
  sentiment: RedditSentiment | null;
  sentimentScore: number | null;
  /** Also a reporter or a gap-screen name today — a genuine cross-check
   * rather than a crowd report. */
  inTodaysBrief: boolean;
}

export interface RedditScanOptions {
  /** Tickers already on today's brief (earnings + gap screen). */
  briefTickers: Set<string>;
  /** Below this a ticker is one person posting, not a crowd. */
  minMentions?: number;
  /** Lead slots reserved for brief overlaps, so a heavy overlap day still
   * reports what retail surfaced on its own. */
  maxBriefOverlap?: number;
  limit?: number;
}

const DEFAULT_MIN_MENTIONS = 25;
const DEFAULT_MAX_BRIEF_OVERLAP = 4;
const DEFAULT_LIMIT = 8;

interface Accumulated {
  ticker: string;
  name: string | null;
  subreddit: string;
  topSubredditMentions: number;
  mentions: number;
  mentions24hAgo: number | null;
  rank: number;
}

export function buildRedditScan(
  mentions: ApeWisdomMention[],
  sentiment: Map<string, TradestieEntry>,
  opts: RedditScanOptions,
): RedditScanItem[] {
  const {
    briefTickers,
    minMentions = DEFAULT_MIN_MENTIONS,
    maxBriefOverlap = DEFAULT_MAX_BRIEF_OVERLAP,
    limit = DEFAULT_LIMIT,
  } = opts;

  // A ticker trending in three subreddits is one story, not three bullets.
  const merged = new Map<string, Accumulated>();
  for (const row of mentions) {
    const existing = merged.get(row.ticker);
    if (!existing) {
      merged.set(row.ticker, {
        ticker: row.ticker,
        name: row.name,
        subreddit: row.subreddit,
        topSubredditMentions: row.mentions,
        mentions: row.mentions,
        mentions24hAgo: row.mentions24hAgo,
        rank: row.rank,
      });
      continue;
    }
    existing.mentions += row.mentions;
    if (row.mentions24hAgo != null) {
      existing.mentions24hAgo = (existing.mentions24hAgo ?? 0) + row.mentions24hAgo;
    }
    existing.name ??= row.name;
    existing.rank = Math.min(existing.rank, row.rank);
    // Attribute the story to whichever subreddit is loudest about it.
    if (row.mentions > existing.topSubredditMentions) {
      existing.topSubredditMentions = row.mentions;
      existing.subreddit = row.subreddit;
    }
  }

  const items: RedditScanItem[] = [];
  for (const row of merged.values()) {
    if (row.mentions < minMentions) continue;
    const entry = sentiment.get(row.ticker);
    items.push({
      ticker: row.ticker,
      name: row.name,
      subreddit: row.subreddit,
      mentions: row.mentions,
      mentions24hAgo: row.mentions24hAgo,
      momentum: momentumOf(row.mentions, row.mentions24hAgo),
      rank: row.rank,
      sentiment: entry?.sentiment ?? null,
      sentimentScore: entry?.score ?? null,
      inTodaysBrief: briefTickers.has(row.ticker),
    });
  }

  // A missing baseline sorts as "unchanged" rather than last: a first
  // appearance is interesting, but it is not evidence of a spike.
  const byInterest = (a: RedditScanItem, b: RedditScanItem) => {
    const left = a.momentum ?? 1;
    const right = b.momentum ?? 1;
    if (left !== right) return right - left;
    return b.mentions - a.mentions;
  };

  const overlaps = items.filter((i) => i.inTodaysBrief).sort(byInterest).slice(0, maxBriefOverlap);
  const taken = new Set(overlaps.map((i) => i.ticker));
  const rest = items.filter((i) => !taken.has(i.ticker)).sort(byInterest);

  return [...overlaps, ...rest].slice(0, limit);
}

function momentumOf(mentions: number, baseline: number | null): number | null {
  if (baseline == null || baseline <= 0) return null;
  return mentions / baseline;
}
