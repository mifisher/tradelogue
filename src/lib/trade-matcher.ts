/**
 * trade-matcher.ts — Pure helpers for journal-trade → DB-trade matching.
 *
 * The primary single-trade matching logic lives in scripts/import-journal.ts.
 * This module provides the combination-match pass for "×N" journal trades
 * whose recorded PnL is the combined total of N separate DB round-trips
 * on the same contract in the same session.
 */

export interface CandidateTrade {
  firstExecId: string;
  pnl: number | null;
}

/**
 * Generate all combinations of `size` elements from `arr`.
 * Yields each combination as an array (order preserved from input).
 */
export function* combinations<T>(arr: T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= arr.length - size; i++) {
    for (const rest of combinations(arr.slice(i + 1), size - 1)) {
      yield [arr[i], ...rest];
    }
  }
}

/**
 * Find the smallest combination of candidates whose summed realizedPnl is
 * within `tolerance` of `journalPnl`.
 *
 * Selection rules (in priority order):
 *   1. Smallest combo size (prefer 2 over 3 over 4 …)
 *   2. Among same-size combos, smallest |diff|
 *
 * Returns the firstExecIds of the winning combo, or null if nothing matched.
 *
 * Candidates with null pnl are treated as pnl=0 for the sum (conservative).
 *
 * @param journalPnl  The combined PnL value from the journal header.
 * @param candidates  Unused DB trades for this (date, underlying, putCall).
 * @param tolerance   Max allowed |sum - journalPnl| to count as a match (default $25).
 * @param maxSize     Maximum combo size to try (default 4).
 */
export function findComboMatch(
  journalPnl: number,
  candidates: CandidateTrade[],
  tolerance = 25,
  maxSize = 4,
): string[] | null {
  const limit = Math.min(maxSize, candidates.length);

  // Try sizes 2, 3, … limit in order (never size 1 — that's handled by primary pass)
  for (let size = 2; size <= limit; size++) {
    let bestIds: string[] | null = null;
    let bestDiff = Infinity;

    for (const combo of combinations(candidates, size)) {
      const sum = combo.reduce((acc, c) => acc + (c.pnl ?? 0), 0);
      const diff = Math.abs(sum - journalPnl);
      if (diff <= tolerance && diff < bestDiff) {
        bestDiff = diff;
        bestIds = combo.map((c) => c.firstExecId);
      }
    }

    if (bestIds !== null) {
      return bestIds;
    }
  }

  return null;
}
