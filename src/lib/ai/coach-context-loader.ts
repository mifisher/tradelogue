// ── Coach context loader — DB fetches + pure builder ─────────────────────────
// Centralises the data-assembly logic so both ai-actions.ts (server action)
// and scripts/eval-coaching.ts (eval harness) stay in sync.
// No Next.js imports; safe to call from CLI tsx scripts.

import {
  closedTrades,
  dailySummaries,
  getSession,
  getAnnotationsByExecIds,
  getSetups,
  toStatTrade,
} from '@/lib/queries';
import { violationsForSession } from '@/lib/discipline';
import { computeStats } from '@/lib/stats';
import { buildCoachContext } from '@/lib/ai/coach-context';
import type { CoachTradeInput } from '@/lib/ai/coach-context';
import { getRuleConfigs } from '@/lib/trading-rules';
import { TRADING_TIMEZONE } from '@/lib/config';

const TZ_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Assemble the plain-text coaching context for a given session date.
 * Makes several DB queries and calls buildCoachContext (pure).
 *
 * @returns The context string ready to send to generateCoachingReview.
 */
export async function assembleCoachContext(sessionDate: string): Promise<string> {
  // Fetch all data in parallel where possible
  const [sessionRow, dayTrades, allDays, ruleConfigs, setupRows] = await Promise.all([
    getSession(sessionDate),
    closedTrades({ from: sessionDate, to: sessionDate }),
    dailySummaries(),
    getRuleConfigs(),
    getSetups(),
  ]);

  // Sort trades chronologically
  const sortedTrades = [...dayTrades].sort(
    (a, b) => a.openedAt.getTime() - b.openedAt.getTime(),
  );

  // Fetch annotations for this day's trades
  const execIds = sortedTrades
    .map((r) => r.firstExecId)
    .filter((id): id is string => id != null);
  const annotationsMap = await getAnnotationsByExecIds(execIds);

  // Build violations for this session
  const violations = violationsForSession(
    sessionDate,
    sortedTrades,
    sessionRow?.sentiment ?? null,
    ruleConfigs,
  );

  // Build trades context input
  const tradesInput: CoachTradeInput[] = sortedTrades.map((row) => {
    const ann = row.firstExecId ? annotationsMap.get(row.firstExecId) : null;
    const holdMs = row.closedAt && row.openedAt
      ? row.closedAt.getTime() - row.openedAt.getTime()
      : 0;
    return {
      timePT: TZ_TIME.format(row.openedAt),
      ticker: row.underlying,
      description: row.description,
      qty: row.quantityOpened,
      entry: row.avgEntryPrice,
      exit: row.avgExitPrice ?? 0,
      holdMs,
      pnl: row.realizedPnl ?? 0,
      setupName: ann?.setupNumber != null ? `Setup ${ann.setupNumber}` : null,
      grade: ann?.grade ?? null,
      thesis: ann?.thesis ?? null,
      executionNotes: ann?.executionNotes ?? null,
    };
  });

  // Compute recent 10 days (before the session date) with violation counts
  const sortedDays = [...allDays].sort((a, b) => a.day.localeCompare(b.day));
  const dayIndex = sortedDays.findIndex((d) => d.day === sessionDate);
  const recentSlice = dayIndex >= 0
    ? sortedDays.slice(Math.max(0, dayIndex - 10), dayIndex + 1)
    : sortedDays.slice(-10);

  // Compute violations for each recent day
  const recentDaysWithViolations = await Promise.all(
    recentSlice.map(async (d) => {
      const dayT = await closedTrades({ from: d.day, to: d.day });
      // Use null sentiment for recent days — minor tradeoff, keeps it fast
      const v = violationsForSession(d.day, dayT, null, ruleConfigs);
      return {
        day: d.day,
        pnl: d.pnl,
        tradeCount: d.tradeCount,
        violationCount: v.length,
      };
    }),
  );

  // Compute all-time stats
  const allStatTrades = (await closedTrades()).map(toStatTrade);
  const allStats = computeStats(allStatTrades);

  // Count winning days for winRateDays
  const winDays = allDays.filter((d) => d.pnl > 0).length;
  const winRateDays = allDays.length > 0 ? winDays / allDays.length : 0;

  return buildCoachContext({
    session: {
      sessionDate,
      sentiment: sessionRow?.sentiment ?? null,
      mood: sessionRow?.mood ?? null,
      sleepScore: sessionRow?.sleepScore ?? null,
      sleepMinutes: sessionRow?.sleepMinutes ?? null,
      marketContext: sessionRow?.marketContext ?? null,
      recap: sessionRow?.recap ?? null,
      journalPnl: sessionRow?.journalPnl ?? null,
    },
    trades: tradesInput,
    violations,
    rulebook: ruleConfigs
      .filter((r) => r.enabled)
      .map((r) => ({ rule: r.rule, title: r.title, description: r.description })),
    setupNames: setupRows.map((r) => ({ number: r.number, name: r.name })),
    recentDays: recentDaysWithViolations,
    allTime: {
      totalPnl: allStats.totalPnl,
      winRateDays,
      profitFactor: allStats.profitFactor,
    },
  });
}
