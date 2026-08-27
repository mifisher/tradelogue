/** ApeWisdom — how often each ticker is being mentioned on a subreddit, and
 * what that count looked like 24 hours ago.
 *
 * The brief used to source its Reddit section from Tavily `site:reddit.com`
 * searches. Tavily does not index Reddit comment bodies, so those queries came
 * back with subreddit landing pages, "Prove your humanity" bot walls, and
 * threads from 2021 — and the model, given nothing real, invented a $30 price
 * target for a four-figure stock. Reddit's own JSON now 403s for anonymous
 * clients on every host and user-agent, so this aggregator is the way to get
 * real counts without asking the trader to register an OAuth app.
 *
 * The 24h baseline is the point: an absolute mention count only says a ticker
 * is crowded, while the change says something happened. HTZ going from 6
 * mentions to 675 overnight is the signal; SPY sitting at 447 every day is not. */

const BASE = 'https://apewisdom.io/api/v1.0/filter';

export class ApeWisdomError extends Error {}

export interface ApeWisdomMention {
  ticker: string;
  name: string | null;
  subreddit: string;
  rank: number;
  /** Null when the ticker was not ranked 24h ago — a first appearance. */
  rank24hAgo: number | null;
  mentions: number;
  /** Null when there is no baseline; never zero, which would read as an
   * infinite spike on every new ticker. */
  mentions24hAgo: number | null;
  upvotes: number;
}

interface Opts {
  fetchFn?: typeof fetch;
}

interface RawRow {
  ticker?: string;
  name?: string;
  rank?: number;
  rank_24h_ago?: number;
  mentions?: number;
  mentions_24h_ago?: number;
  upvotes?: number;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/** Names arrive HTML-escaped ("SPDR S&amp;P 500 ETF Trust"). */
function unescapeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
}

/** One page is 100 tickers ranked by mentions — far past anything the brief
 * would surface, so the paginated tail is never worth the round trip. */
export async function fetchApeWisdom(subreddit: string, opts: Opts = {}): Promise<ApeWisdomMention[]> {
  const { fetchFn = fetch } = opts;
  const res = await fetchFn(`${BASE}/${encodeURIComponent(subreddit)}/page/1`);
  if (!res.ok) throw new ApeWisdomError(`ApeWisdom failed (${res.status})`);

  const body = (await res.json()) as { results?: RawRow[] };
  const rows: ApeWisdomMention[] = [];
  for (const raw of body.results ?? []) {
    const ticker = raw.ticker?.trim().toUpperCase();
    if (!ticker) continue;
    rows.push({
      ticker,
      name: raw.name ? unescapeHtml(raw.name.trim()) : null,
      subreddit,
      rank: raw.rank ?? 0,
      rank24hAgo: raw.rank_24h_ago ?? null,
      mentions: raw.mentions ?? 0,
      mentions24hAgo: raw.mentions_24h_ago ?? null,
      upvotes: raw.upvotes ?? 0,
    });
  }
  return rows;
}
