import { lookupQuote, type FinnhubQuote } from './finnhub';
import type { StockInPlay, StockQuote, StoredStockInPlay } from './brief-schema';

/** Finnhub free tier allows 60 calls/minute and a brief carries at most a
 * handful of picks, so a small fan-out is plenty. */
const QUOTE_CONCURRENCY = 4;

/** Keep the first mention of each ticker. The model has repeated a name inside
 * one brief (MSFT twice, with two different biases), which reads as two
 * independent ideas when it is one name argued twice. First wins because the
 * model leads with its strongest-evidenced case. */
export function dedupeStocksInPlay<T extends { ticker: string }>(picks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const pick of picks) {
    const key = pick.ticker.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

/** Drop picks reporting after today's close. The prompt states the rule, but
 * "never hold a name into its own earnings" is the trader's rule, not a
 * preference the model gets to weigh — so a slip drops the pick rather than
 * reaching the page. */
export function filterStocksInPlay<T extends { ticker: string }>(
  picks: T[],
  lateReporters: Set<string>,
): T[] {
  return picks.filter((p) => !lateReporters.has(p.ticker.trim().toUpperCase()));
}

export interface FinalizeOptions {
  lateReporters: Set<string>;
  finnhubKey: string;
  fetchFn?: typeof fetch;
  /** Quotes already fetched for the prompt's candidate table. Reusing them
   * keeps a pick the model took from that table off Finnhub's rate limit a
   * second time. */
  knownQuotes?: Map<string, FinnhubQuote>;
}

function toStockQuote(quote: FinnhubQuote): StockQuote {
  return {
    price: quote.current,
    changePct: quote.changePct,
    prevClose: quote.prevClose,
    dayHigh: quote.high > 0 ? quote.high : null,
    dayLow: quote.low > 0 ? quote.low : null,
  };
}

/** Settle the pick list: drop after-close reporters, collapse repeats, then
 * attach a real quote to each survivor.
 *
 * A ticker Finnhub does not know is dropped outright — that is a fabricated
 * symbol (the model has emitted "FORD" for F), and a pick whose ticker does not
 * exist cannot be traded. A quote request that *errors* keeps the pick with a
 * null quote instead: an unreachable API is our problem, not evidence against
 * the name. */
export async function finalizeStocksInPlay(
  picks: StockInPlay[],
  opts: FinalizeOptions,
): Promise<StoredStockInPlay[]> {
  const { lateReporters, finnhubKey, fetchFn = fetch, knownQuotes } = opts;
  const candidates = dedupeStocksInPlay(filterStocksInPlay(picks, lateReporters));

  const results = new Array<StoredStockInPlay | null>(candidates.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(QUOTE_CONCURRENCY, candidates.length) }, async () => {
    while (next < candidates.length) {
      const index = next++;
      const pick = candidates[index];
      const symbol = pick.ticker.trim().toUpperCase();

      const known = knownQuotes?.get(symbol);
      if (known) {
        results[index] = { ...pick, quote: toStockQuote(known) };
        continue;
      }

      try {
        const quote = await lookupQuote(symbol, { apiKey: finnhubKey, fetchFn });
        results[index] = quote
          ? { ...pick, quote: toStockQuote(quote) }
          : null; // no such symbol — the model invented it
      } catch {
        results[index] = { ...pick, quote: null }; // Finnhub unreachable; keep the idea
      }
    }
  });
  await Promise.all(workers);

  return results.filter((p): p is StoredStockInPlay => p !== null);
}
