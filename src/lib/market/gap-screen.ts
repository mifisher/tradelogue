import { earningsWindow } from './brief-time';
import type { FinnhubEarning } from './finnhub';
import type { YahooQuote } from './yahoo';

/** The morning gap screen: which companies have already reported, and what did
 * the tape do about it.
 *
 * This exists because Stocks in Play used to be pure model judgement over
 * whatever the news search happened to return, and the news search is noisy.
 * On 2026-08-06 that produced NVDA on "AI sector momentum", a microcap whose
 * earnings were a week away, and a name whose only catalyst was its own price
 * move — while DDOG (-19%), PTON (-16%) and U (+14%) all reported before the
 * bell and never reached the prompt at all.
 *
 * Every name here has both halves the brief asks for, from data rather than
 * inference: a dateable catalyst (it reported, and by how much it beat) and a
 * measured move (the gap from its previous close). The model's job shrinks to
 * writing the plan, which is the part it is actually good at.
 */

export type ReportedAt = 'this morning before open' | 'last night after close';

export interface GapCandidate {
  ticker: string;
  reportedAt: ReportedAt;
  /** Gap from the previous close, in percent. Negative is a gap down. */
  gapPct: number;
  price: number;
  prevClose: number;
  marketCap: number | null;
  /** Session volume over the 10-day average; null before it is measurable. */
  relVolume: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  /** EPS surprise in percent, null when there was no estimate. */
  surprisePct: number | null;
}

export interface GapScreenOptions {
  /** Below this the name is a microcap whose gap the trader cannot size into. */
  minMarketCap?: number;
  /** Below this it is drift, not a gap. */
  minGapPct?: number;
  limit?: number;
}

/** The trader works liquid mega-cap names and their options, so size is a
 * liquidity filter, not snobbery. Ranking on gap alone put a $2.8B biotech at
 * +43% and a $4.2B name at -39% above DDOG (-19%, $82B), HUBS (-19%) and U
 * (+15%) on a live slate — the small caps win a raw-percentage contest almost
 * every morning, and they are exactly the names whose spreads punish an options
 * entry. Raising the floor to $10B put all three tradable names back on the
 * screen. */
const DEFAULT_MIN_MARKET_CAP = 10_000_000_000;
const DEFAULT_MIN_GAP_PCT = 3;
/** Ten candidates for a section that picks 3-5: enough that the model can drop
 * the ones it cannot write a real plan for and still fill the card. */
const DEFAULT_LIMIT = 10;

/** Reporters whose news broke into the session the trader is about to trade:
 * this morning before the open, or last night after the close. Both gap this
 * morning; a name that reported before yesterday's open has had a full session
 * to price it in, and one reporting after today's close has not reported at all.
 *
 * `epsActual` is the confirmation. The calendar's hour says when a company is
 * *scheduled* to report, so a before-open row with no actual on it is either
 * still pending or was quietly moved — either way there is no news yet, and the
 * screen would be ranking a gap it cannot explain. */
export function freshReporters(rows: FinnhubEarning[], todayPt: string): FinnhubEarning[] {
  const previousSession = earningsWindow(todayPt)[0];
  return rows.filter((row) => {
    if (row.epsActual == null) return false;
    if (row.date === todayPt) return row.hour === 'bmo';
    if (row.date === previousSession) return row.hour === 'amc';
    return false;
  });
}

/** Rank the fresh reporters by how far they gapped. */
export function buildGapScreen(
  rows: FinnhubEarning[],
  quotes: Map<string, YahooQuote>,
  todayPt: string,
  opts: GapScreenOptions = {},
): GapCandidate[] {
  const {
    minMarketCap = DEFAULT_MIN_MARKET_CAP,
    minGapPct = DEFAULT_MIN_GAP_PCT,
    limit = DEFAULT_LIMIT,
  } = opts;

  const candidates: GapCandidate[] = [];
  for (const row of freshReporters(rows, todayPt)) {
    const quote = quotes.get(row.symbol.trim().toUpperCase());
    // No quote is no evidence. Keeping the name at an implied 0% would rank it
    // as the calmest stock on the board rather than the unknown it is.
    if (!quote) continue;
    if (Math.abs(quote.changePct) < minGapPct) continue;
    // An absent cap means Yahoo had no figure, which is not the same as small —
    // the measured gap is evidence enough to keep the name.
    if (quote.marketCap != null && quote.marketCap < minMarketCap) continue;

    candidates.push({
      ticker: row.symbol.trim().toUpperCase(),
      reportedAt: row.date === todayPt ? 'this morning before open' : 'last night after close',
      gapPct: quote.changePct,
      price: quote.price,
      prevClose: quote.prevClose,
      marketCap: quote.marketCap,
      relVolume: relativeVolume(quote),
      epsEstimate: row.epsEstimate,
      epsActual: row.epsActual,
      surprisePct: surprise(row.epsEstimate, row.epsActual),
    });
  }

  return candidates
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .slice(0, limit);
}

/** Premarket the regular-session volume is still zero, so a ratio would report
 * the day's biggest gap as having no interest behind it. Null is the honest
 * answer until there is something to divide. */
function relativeVolume(quote: YahooQuote): number | null {
  if (!quote.volume || !quote.avgVolume10Day) return null;
  return quote.volume / quote.avgVolume10Day;
}

/** Percent surprise against the estimate. The denominator is the absolute
 * estimate: Unity was forecast to lose 8.75c and earned 28c, and dividing by
 * the signed estimate would render that beat as a -420% miss. */
function surprise(estimate: number | null, actual: number | null): number | null {
  if (estimate == null || actual == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}
