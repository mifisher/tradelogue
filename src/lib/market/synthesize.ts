import { AiProviderError } from '../ai/provider';
import type {
  BriefContent,
  BriefSourceLink,
  EarningsItem,
  EarningsNote,
  RedditNote,
  StoredBriefContent,
  StoredRedditItem,
} from './brief-schema';
import type { RedditScanItem } from './reddit-scan';
import { earningsWindow } from './brief-time';
import { isPriorityName } from './earnings-priority';
import { finalizeStocksInPlay } from './stocks-in-play';
import type { FinnhubEarning } from './finnhub';
import type { GatherResult } from './gather';

export interface RuleContext {
  ruleNumber: number;
  title: string;
  description: string;
}

const SYSTEM = `You are a premarket briefing analyst for an options day trader (PT timezone, trades SPY/QQQ/mega-cap options).
Produce a daily market brief as a single JSON object matching the schema below. Rules:
- Use ONLY the provided research context. Never invent numbers, events, or tickers. If a section's sources are unavailable, return fewer items (empty array is fine, except topStories which needs at least 1).
- The economic calendar is supplied to you from a release-schedule feed and rendered from that feed directly — you do NOT return it. Use it to ground the overview and posture (what has already printed today, what is still ahead), and never restate a release time or date that the feed does not give you.
- earningsNotes: the earnings list itself is built from the calendar in code — you do NOT choose which companies appear. Just add a one-line "watchItem" for the reporters you have something concrete to say about (guidance risk, a key metric, a prior-quarter miss). Reference each by its ticker from the ranked list below. Cover the names you can and skip the rest; an empty array is fine.
- stocksInPlay: 3-5 names set up to break out today in EITHER direction. START FROM THE GAP SCREEN below: every row in it is a company that has already reported into this session and the exact move the tape made in response, which is the strongest catalyst-plus-signal evidence available to you. Work down it in order and take the names you can write a real plan for. Only reach outside the screen when a name has a catalyst just as concrete and dateable — an FDA decision, an analyst upgrade/downgrade or price-target change, M&A, a restructuring, a guidance change — evidenced in the sources below; you may then use the gap screen's own numbers for that name if it appears there. Every pick still needs BOTH (a) a concrete, dateable catalyst and (b) an above-average volume or gap signal. Rank by catalyst specificity: a named, dated event beats "momentum" or "sector strength", which do not qualify on their own. A price move is a signal, never a catalyst — "broke below its 50-day" and "gapped down 4%" describe what happened, not why, so neither can be the catalyst for a pick. An earnings date in the FUTURE is not a catalyst either: the news has to already be out. Drop any name whose catalyst or volume evidence you cannot point to in the sources — 3 well-evidenced names beat 5 padded ones. "catalyst" = what happened and when; "signal" = the volume/gap evidence and which way it is pointing; "approach" = a level-based, confirmation-first day-trading plan (what has to hold or reclaim first), never a buy/sell recommendation. The live quote table below is your ONLY source of prices. You may cite a dollar level only for a ticker listed there, and only consistent with its numbers — a stop below the session low, or a "resistance" under the last price, tells the trader you made it up. Prefer picking names that appear in that table. For any ticker not in it you have no price data at all: name the level instead (premarket high/low, prior-day high/low, the earnings gap level, VWAP, the opening range), which the trader reads off their own chart. An invented level is worse than no level.
- NEVER put a company that reports after today's close into stocksInPlay — the trader does not hold those. They are listed explicitly below. A company that already reported before the open is fine: the news is out.
- redditNotes: the trending-ticker list is built in code from real mention counts — you do NOT choose which tickers appear. Your note must contain NO NUMBERS AT ALL: no mention count, no momentum multiple, no price, no price target, no percentage. Every figure is already printed on the row next to your note, and restating one is how a neighbouring row's number ends up attached to the wrong ticker. Write only the qualitative read: what the crowd's thesis appears to be, or what a mention spike lines up with in today's news. Reference each by its ticker from the scan below. Skip the ones you have no basis for; an empty array is fine, and silence beats a guess.
- redditDivergence: one or two sentences, containing NO NUMBERS, on where retail positioning runs OPPOSITE to the tape. Divergence means the two disagree: bullish crowd + gap DOWN, or bearish crowd + gap UP. A bearish crowd on a name that gapped down is agreement, not divergence — do not report it as one. Name the tickers. These are the high-volatility setups because one side has to capitulate. If no ticker in the scan has the crowd and the tape pointing opposite ways, say exactly that in one line rather than relabelling an agreement.
- rulesFocus: pick the 2-4 provided trading rules most relevant to today's tape and explain why ("whyToday").
- Be terse and factual. Note source disagreement where it exists.

JSON schema (all fields required; nullable where noted):
{
  "overview": string,            // 3-6 sentence market overview (futures/tape narrative)
  "tradingPosture": string,      // 1-2 sentence posture for the open
  "topStories": [{ "headline": string, "summary": string, "sourceUrl": string|null }],   // 3-6 items
  "earningsNotes": [{ "ticker": string, "watchItem": string }],   // optional; one-line watch note per reporter you can speak to, keyed by ticker. The list of companies shown is built in code, not here
  "stocksInPlay": [{ "ticker": string, "catalyst": string, "signal": string, "approach": string }],   // 3-5 items
  "redditNotes": [{ "ticker": string, "note": string }],   // optional; one line per trending ticker you can speak to. The list shown is built in code, not here
  "redditDivergence": string,   // 1-2 sentences naming where retail and the tape disagree
  "rulesFocus": [{ "ruleNumber": number, "title": string, "whyToday": string }]
}`;

const MAX_CONTENT_CHARS = 1500;

/** Finnhub returns the week's calendar date-DESCENDING (furthest day first),
 * several hundred rows deep and alphabetical within a day, so taking the head
 * of the array silently drops the near days entirely. Bucket by date ascending
 * and rank within each day, giving the current session the larger share since
 * that is what actually gets traded. */
/** Base row count per session — how many NON-priority names fill the column.
 * Applied per session (not per day) so a morning-heavy date cannot crowd the
 * after-close names out of view. Undated rows are mostly micro caps Finnhub has
 * not timed yet, so they get a short tail rather than equal billing. */
const SESSION_LIMITS: Record<EarningsItem['timing'], number> = {
  BMO: 6,
  AMC: 6,
  unknown: 2,
};
/** Priority names (traded + watchlist) always show — the cap only trims noise —
 * but a pathological all-priority session still needs a ceiling. */
const PRIORITY_MAX_PER_SESSION = 8;
const SESSION_ORDER: EarningsItem['timing'][] = ['BMO', 'AMC', 'unknown'];

export interface EarningsRankingContext {
  /** symbol → market cap (millions USD); missing means "unknown", not "small". */
  marketCaps?: Map<string, number>;
  /** Underlyings the trader actually trades — these outrank everything. */
  tradedTickers?: Iterable<string>;
}

/** Rank a day's reporters: priority names first (the trader's own tickers and
 * the watchlist, so a highlighted name reliably survives the per-session cut),
 * then by market cap, then revenue. Market cap is the notability proxy — revenue
 * alone buries a Schwab or an MSCI under low-margin giants, which is exactly how
 * the big names went missing. Revenue only breaks ties when no cap is known. */
export function selectEarnings(
  rows: FinnhubEarning[],
  todayPt: string,
  context: EarningsRankingContext = {},
): FinnhubEarning[] {
  const caps = context.marketCaps ?? new Map<string, number>();
  const traded = new Set([...(context.tradedTickers ?? [])].map((t) => t.toUpperCase()));
  const window = earningsWindow(todayPt);
  const inWindow = new Set(window);

  // date → session → rows
  const byDate = new Map<string, Map<string, FinnhubEarning[]>>();
  for (const row of rows) {
    if (!inWindow.has(row.date)) continue; // outside the five-session window
    const sessions = byDate.get(row.date) ?? new Map<string, FinnhubEarning[]>();
    const session = timingFromHour(row.hour);
    const bucket = sessions.get(session);
    if (bucket) bucket.push(row);
    else sessions.set(session, [row]);
    byDate.set(row.date, sessions);
  }

  const rank = (row: FinnhubEarning) => ({
    priority: isPriorityName(row.symbol, traded) ? 1 : 0,
    cap: caps.get(row.symbol) ?? 0,
    revenue: row.revenueEstimate ?? 0,
  });

  const selected: FinnhubEarning[] = [];
  for (const date of window) {
    const sessions = byDate.get(date);
    if (!sessions) continue;
    for (const session of SESSION_ORDER) {
      const group = sessions.get(session);
      if (!group) continue;
      const ranked = [...group].sort((a, b) => {
        const left = rank(a);
        const right = rank(b);
        if (left.priority !== right.priority) return right.priority - left.priority;
        if (left.cap !== right.cap) return right.cap - left.cap;
        return right.revenue - left.revenue;
      });
      // Show every priority name (capped for pathological days), then the top
      // non-priority reporters — and give the second group its full quota
      // rather than the remainder. A highlighted name is an addition to the
      // day's notable list, not a substitution: subtracting it from the same
      // budget meant putting QBTS and OSCR on the watchlist silently cost the
      // column DDOG and WBD, the two biggest reporters of that session.
      const priority = ranked.filter((r) => isPriorityName(r.symbol, traded)).slice(0, PRIORITY_MAX_PER_SESSION);
      const rest = ranked
        .filter((r) => !isPriorityName(r.symbol, traded))
        .slice(0, SESSION_LIMITS[session]);
      selected.push(...priority, ...rest);
    }
  }
  return selected;
}

function timingFromHour(hour: string): EarningsItem['timing'] {
  return hour === 'bmo' ? 'BMO' : hour === 'amc' ? 'AMC' : 'unknown';
}

/** Names the trader will not take into the close today: anything reporting
 * after the bell, plus anything Finnhub has not timed — an unconfirmed hour
 * today could still be an after-close print, and the cost of wrongly excluding
 * a name is one missed idea against holding a stock into its own earnings.
 * A before-open reporter is not excluded: that news is already in the tape. */
export function lateReportersToday(rows: FinnhubEarning[], todayPt: string): Set<string> {
  const late = new Set<string>();
  for (const row of rows) {
    if (row.date !== todayPt || timingFromHour(row.hour) === 'BMO') continue;
    if (row.symbol) late.add(row.symbol.trim().toUpperCase());
  }
  return late;
}


/** Build the earnings card deterministically from the ranked calendar. Every
 * structural field — ticker, date, timing, EPS estimate — comes from Finnhub,
 * and the company name from the profile fetch (ticker fallback when absent).
 * The model can never invent a reporter or drop one by being terse; it only
 * contributes watchItems, matched back by ticker. */
export function buildEarnings(
  ranked: FinnhubEarning[],
  companyNames: Map<string, string>,
  notes: EarningsNote[],
): EarningsItem[] {
  const noteByTicker = new Map<string, string>();
  for (const note of notes) {
    const key = note.ticker.trim().toUpperCase();
    if (!noteByTicker.has(key)) noteByTicker.set(key, note.watchItem.trim());
  }

  return ranked.map((row) => ({
    ticker: row.symbol,
    company: companyNames.get(row.symbol) ?? row.symbol,
    date: row.date,
    timing: timingFromHour(row.hour),
    epsEstimate: row.epsEstimate != null ? String(row.epsEstimate) : null,
    watchItem: noteByTicker.get(row.symbol.toUpperCase()) ?? '',
  }));
}

/** A note is prose only. The prompt says so and the model writes numbers
 * anyway — a "$30 price target" on a four-figure stock, a "breakout above $175"
 * on a name trading in single digits, a momentum multiple lifted off the
 * neighbouring row. Every genuine figure is already rendered beside the note,
 * so one that appears inside it is redundant at best and fabricated at worst,
 * and the trader has no way to tell which. Dropping the sentence is the only
 * safe reading; the row keeps its real numbers either way. */
const CONTAINS_DIGIT = /\d/;

/** Join the model's one-liners onto the real mention rows, matched by ticker.
 * Same contract as buildEarnings: the rows come from the feed, the model only
 * annotates them, and a note for a ticker that is not trending is discarded
 * rather than becoming a row of its own. */
export function buildRedditRows(
  scan: RedditScanItem[],
  notes: RedditNote[],
): StoredRedditItem[] {
  const noteByTicker = new Map<string, string>();
  for (const note of notes) {
    const key = note.ticker.trim().toUpperCase();
    const text = note.note.trim();
    if (CONTAINS_DIGIT.test(text)) continue;
    if (!noteByTicker.has(key)) noteByTicker.set(key, text);
  }

  return scan.map((item) => ({
    ticker: item.ticker,
    name: item.name,
    subreddit: item.subreddit,
    mentions: item.mentions,
    mentions24hAgo: item.mentions24hAgo,
    momentum: item.momentum,
    sentiment: item.sentiment,
    sentimentScore: item.sentimentScore,
    inTodaysBrief: item.inTodaysBrief,
    note: noteByTicker.get(item.ticker.toUpperCase()) ?? '',
  }));
}

export function buildBriefPrompt(
  gather: GatherResult,
  rules: RuleContext[],
  todayPt: string,
  rankedEarnings: FinnhubEarning[],
): { system: string; user: string } {
  const parts: string[] = [`Trading date (PT): ${todayPt}`];

  if (gather.quotes.status === 'ok' && gather.quotes.data) {
    parts.push('## Index snapshot (from market data APIs — for narrative context only)');
    for (const a of gather.quotes.data.assets) {
      parts.push(`- ${a.label}: ${a.value} (${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}, ${a.changePct.toFixed(2)}%)`);
    }
  } else {
    parts.push('## Index snapshot: UNAVAILABLE');
  }

  parts.push('## US economic releases this week (from the release-schedule feed; times are ET. Already on the brief — context only, do not return these)');
  if (gather.econCalendar.status === 'ok' && gather.econCalendar.data) {
    parts.push(
      JSON.stringify(
        gather.econCalendar.data.map((e) => ({
          date: e.date, timeEt: e.timeEt, name: e.name,
          forecast: e.expected, previous: e.previous, impact: e.impact,
        })),
      ),
    );
  } else {
    parts.push(`UNAVAILABLE (${gather.econCalendar.error})`);
  }

  parts.push('## Already reported into this session, ranked by gap (the gap screen — start stocksInPlay here)');
  if (gather.gapScreen.status === 'ok' && gather.gapScreen.data) {
    const screen = gather.gapScreen.data;
    if (screen.length === 0) {
      parts.push('None — nobody with a tradable gap has reported yet.');
    } else {
      parts.push('ticker | gap% | last | prevClose | EPS actual vs est (surprise) | relVol | reported');
      for (const c of screen) {
        const surprise = c.surprisePct == null ? 'n/a' : `${c.surprisePct >= 0 ? '+' : ''}${c.surprisePct.toFixed(1)}%`;
        const eps = c.epsActual == null ? 'n/a' : `${c.epsActual} vs ${c.epsEstimate ?? 'n/a'} (${surprise})`;
        const relVol = c.relVolume == null ? 'n/a premarket' : `${c.relVolume.toFixed(1)}x`;
        parts.push(
          `${c.ticker} | ${c.gapPct >= 0 ? '+' : ''}${c.gapPct.toFixed(2)}% | ${c.price} | ${c.prevClose} | ${eps} | ${relVol} | ${c.reportedAt}`,
        );
      }
    }
  } else {
    parts.push(`UNAVAILABLE (${gather.gapScreen.error})`);
  }

  parts.push("## Reddit trending tickers (real mention counts; the card shows exactly these — add redditNotes by ticker)");
  if (gather.redditScan.status === 'ok' && gather.redditScan.data) {
    const scan = gather.redditScan.data;
    if (scan.length === 0) {
      parts.push('None — no ticker cleared the mention floor this morning.');
    } else {
      parts.push('ticker | mentions (24h ago) | momentum | sentiment | subreddit | already on this brief');
      for (const r of scan) {
        const momentum = r.momentum == null ? 'no baseline' : `${r.momentum.toFixed(1)}x`;
        parts.push(
          `${r.ticker} | ${r.mentions} (${r.mentions24hAgo ?? 'n/a'}) | ${momentum} | ` +
          `${r.sentiment ?? 'unknown'} | r/${r.subreddit} | ${r.inTodaysBrief ? 'YES' : 'no'}`,
        );
      }
    }
  } else {
    parts.push(`UNAVAILABLE (${gather.redditScan.error})`);
  }

  parts.push('## Live quotes for tickers in today\'s news (real market data — the ONLY prices you may cite in stocksInPlay)');
  if (gather.candidateQuotes.size > 0) {
    parts.push('ticker | last | change% | prevClose | sessionRange');
    for (const [symbol, q] of [...gather.candidateQuotes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const range = q.high > 0 && q.low > 0 ? `${q.low}-${q.high}` : 'not open yet';
      parts.push(`${symbol} | ${q.current} | ${q.changePct.toFixed(2)}% | ${q.prevClose} | ${range}`);
    }
  } else {
    parts.push('None priced — do not cite any dollar level; name levels instead.');
  }

  const lateReporters = lateReportersToday(gather.earningsCalendar.data ?? [], todayPt);
  parts.push('## Reporting AFTER today\'s close — banned from stocksInPlay (the trader does not hold a name into its own earnings)');
  parts.push(lateReporters.size > 0 ? [...lateReporters].sort().join(', ') : 'None scheduled.');

  parts.push('## Earnings reporting this week (ranked; the card shows exactly these — add earningsNotes by ticker)');
  if (gather.earningsCalendar.status === 'ok') {
    const rows = rankedEarnings.map((r) => ({
      ticker: r.symbol,
      company: gather.companyNames.get(r.symbol) ?? r.symbol,
      date: r.date,
      timing: timingFromHour(r.hour),
      epsEstimate: r.epsEstimate,
    }));
    parts.push(JSON.stringify(rows));
  } else {
    parts.push(`UNAVAILABLE (${gather.earningsCalendar.error})`);
  }

  for (const s of gather.searches) {
    if (s.source.status === 'ok' && s.source.data) {
      parts.push(`## ${s.label}`);
      for (const r of s.source.data) {
        parts.push(`### ${r.title}\nURL: ${r.url}\nPublished: ${r.publishedDate ?? 'unknown'}\n${r.content.slice(0, MAX_CONTENT_CHARS)}`);
      }
    } else {
      parts.push(`## ${s.label}: UNAVAILABLE (${s.source.error})`);
    }
  }

  parts.push('## Trader\'s active rules (choose 2-4 for rulesFocus)');
  for (const r of rules) {
    parts.push(`- Rule ${r.ruleNumber} — ${r.title}: ${r.description}`);
  }

  return { system: SYSTEM, user: parts.join('\n\n') };
}

export function collectSourceLinks(gather: GatherResult): BriefSourceLink[] {
  const links: BriefSourceLink[] = [];
  for (const s of gather.searches) {
    if (s.source.status !== 'ok' || !s.source.data) continue;
    for (const r of s.source.data) {
      if (r.url) links.push({ url: r.url, title: r.title });
    }
  }
  return links;
}

interface SynthesizeOptions {
  gather: GatherResult;
  rules: RuleContext[];
  todayPt: string;
  /** Underlyings the trader actually trades; ranked to the top of the slate. */
  tradedTickers?: string[];
  /** Quotes for the stocks-in-play picks are fetched after synthesis — the
   * tickers are not known until the model has chosen them. */
  finnhubKey: string;
  fetchFn?: typeof fetch;
  /** Provider-backed structured generation (Task 9 wires generateStructuredObject
   * with feature 'brief'); resolves to schema-validated BriefContent. */
  generateFn: (system: string, user: string) => Promise<BriefContent>;
}

/** Call the LLM through the shared provider layer (one retry on
 * validation-type failures; provider errors propagate immediately) and
 * finalize econ event times to UTC. */
export async function synthesizeBrief(opts: SynthesizeOptions): Promise<StoredBriefContent> {
  const { gather, rules, todayPt, tradedTickers = [], finnhubKey, fetchFn, generateFn } = opts;
  // Rank once and reuse: the prompt shows exactly these names, and the stored
  // earnings card is built from the same list, so the two can never diverge.
  const ranked = gather.earningsCalendar.data
    ? selectEarnings(gather.earningsCalendar.data, todayPt, {
        marketCaps: gather.marketCaps,
        tradedTickers,
      })
    : [];
  const { system, user } = buildBriefPrompt(gather, rules, todayPt, ranked);

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\nYour previous output was invalid (${lastError}). Return ONLY a valid JSON object matching the schema.`;
    try {
      const { earningsNotes, redditNotes, ...content } = await generateFn(system, prompt);
      return {
        ...content,
        stocksInPlay: await finalizeStocksInPlay(content.stocksInPlay, {
          lateReporters: lateReportersToday(gather.earningsCalendar.data ?? [], todayPt),
          finnhubKey,
          fetchFn,
          knownQuotes: gather.candidateQuotes,
        }),
        earnings: buildEarnings(ranked, gather.companyNames, earningsNotes),
        // Straight from the mention feeds, same as the econ calendar: the model
        // annotates rows it cannot invent.
        redditScan: buildRedditRows(gather.redditScan.data ?? [], redditNotes),
        // Straight from the release-schedule feed: the model never sees a chance
        // to move a release to the wrong day.
        econCalendar: gather.econCalendar.data ?? [],
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err; // auth/rate-limit/API: retrying can't help
      lastError = err instanceof Error ? err.message.slice(0, 500) : String(err);
    }
  }
  throw new Error(`Synthesis produced an invalid brief after retry: ${lastError}`);
}
