/** Which earnings names get a highlight rail on the calendar, and in what
 * colour. Pure so the rule (Mag 7 vs traded precedence, case-insensitivity) can
 * be tested without rendering the component. */

export type EarningsPriority = 'traded' | 'watch' | null;

/** Mega caps that move the whole tape. GOOG and GOOGL are both Alphabet, so
 * both share classes count. */
export const MAG7 = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'NVDA', 'TSLA'];

/** Extra names the trader wants highlighted that are not Mag 7. Hand-maintained
 * — add tickers here to give them the blue watchlist rail.
 *
 * This list is also the escape hatch from the earnings card's market-cap
 * ranking: a name here floats to the top of its session and is never trimmed by
 * the per-session cap. That is why QBTS (~$4B) and OSCR (~$10B) live here —
 * both are worth watching on a report, and neither can outrank a slate of
 * $100B names on size alone. */
export const WATCHLIST_EXTRA = ['UPS', 'ARM', 'RDDT', 'WDC', 'SNDK', 'MU', 'PLTR', 'QBTS', 'OSCR'];

/** Everything that earns the blue "watchlist" rail: the mega caps plus the
 * hand-picked extras. */
export const WATCHLIST = new Set([...MAG7, ...WATCHLIST_EXTRA]);

export function tradedSet(tickers: Iterable<string>): Set<string> {
  return new Set([...tickers].map((t) => t.toUpperCase()));
}

/** Watchlist wins when a name is both traded and on the watchlist: a trader of
 * every mega cap would otherwise never see the blue rail, collapsing the two
 * categories into one colour. */
export function earningsPriority(ticker: string, traded: Set<string>): EarningsPriority {
  const key = ticker.trim().toUpperCase();
  if (WATCHLIST.has(key)) return 'watch';
  if (traded.has(key)) return 'traded';
  return null;
}

/** Names to float to the top of their session so they reliably appear in the
 * capped list — the trader's own tickers and the watchlist. */
export function isPriorityName(ticker: string, traded: Set<string>): boolean {
  return earningsPriority(ticker, traded) !== null;
}
