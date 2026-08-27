// ── Discipline helper — server-side aggregation over rules engine ────────────
// Pure functions: no DB calls, no side-effects.

import { DEFAULT_RULE_CONFIGS, detectViolations, RULES } from './rules';
import type { RuleConfig, RuleTrade, RuleViolation } from './rules';
import type { TradeRow } from './queries';
import type { DailySummary } from './queries';

// ── Type re-exports ──────────────────────────────────────────────────────────

export type { RuleViolation };

// ── Adapter: TradeRow → RuleTrade ────────────────────────────────────────────

/**
 * Convert a closed TradeRow from the DB into the RuleTrade shape expected by
 * detectViolations.  Caller must guarantee closedAt and realizedPnl are
 * non-null (i.e. the trade is closed) — this is enforced by the type cast.
 */
export function tradeToRuleTrade(row: TradeRow): RuleTrade {
  return {
    firstExecId: row.firstExecId ?? row.id.toString(),
    underlying: row.underlying,
    expiry: row.expiry ?? null,
    openedAt: row.openedAt,
    closedAt: row.closedAt!,
    quantityOpened: row.quantityOpened,
    avgEntryPrice: row.avgEntryPrice,
    realizedPnl: row.realizedPnl!,
  };
}

// ── Per-session violations ────────────────────────────────────────────────────

/**
 * Compute violations for a single session.
 * @param date        YYYY-MM-DD session date
 * @param trades      closed trades for this session (any order — detectViolations sorts)
 * @param sentiment   session sentiment, or null if un-journaled
 */
export function violationsForSession(
  date: string,
  trades: TradeRow[],
  sentiment: string | null,
  rules: RuleConfig[] = DEFAULT_RULE_CONFIGS,
): RuleViolation[] {
  const ruleTrades = trades.map(tradeToRuleTrade);
  return detectViolations({ sessionDate: date, sentiment, trades: ruleTrades }, rules);
}

// ── Dashboard aggregate ───────────────────────────────────────────────────────

export interface ByRuleRow {
  rule: number;
  title: string;
  violationCount: number;
  sessionsAffected: number;
  affectedPnl: number;
}

export interface DisciplineBucket {
  label: string;
  count: number;
  avgPnl: number;
}

export interface DisciplineOverview {
  cleanSessions: { count: number; avgPnl: number };
  violatedSessions: { count: number; avgPnl: number };
  /** Dose-response view: sessions bucketed by violation count (≤2 / 3–5 / 6+). */
  buckets: [DisciplineBucket, DisciplineBucket, DisciplineBucket];
  byRule: ByRuleRow[];
}

/**
 * Aggregate discipline stats across all sessions.
 *
 * @param allTrades   All closed trades (any order).
 * @param sentiments  Map from sessionDate → sentiment (from sentimentByDate()).
 * @param days        DailySummary[] (for P&L per day).
 */
export function disciplineOverview(
  allTrades: TradeRow[],
  sentiments: Map<string, string | null>,
  days: DailySummary[],
  rules: RuleConfig[] = DEFAULT_RULE_CONFIGS,
): DisciplineOverview {
  const titleByRule = new Map(rules.map((rule) => [rule.rule, rule.title]));
  // Build a P&L lookup from dailySummaries
  const pnlByDate = new Map<string, number>(days.map((d) => [d.day, d.pnl]));

  // Group all trades by sessionDate
  const tradesByDate = new Map<string, TradeRow[]>();
  for (const trade of allTrades) {
    if (!trade.sessionDate) continue;
    const existing = tradesByDate.get(trade.sessionDate);
    if (existing) {
      existing.push(trade);
    } else {
      tradesByDate.set(trade.sessionDate, [trade]);
    }
  }

  // Accumulator for by-rule breakdown
  // key: rule number → { violationCount, sessionsAffected (set of dates), affectedPnl }
  const byRule = new Map<
    number,
    { violationCount: number; sessionsAffected: Set<string>; affectedPnl: number }
  >();

  let cleanCount = 0;
  let cleanPnlSum = 0;
  let violatedCount = 0;
  let violatedPnlSum = 0;
  const bucketAcc = [
    { label: '0–2 violations', count: 0, pnlSum: 0 },
    { label: '3–5 violations', count: 0, pnlSum: 0 },
    { label: '6+ violations', count: 0, pnlSum: 0 },
  ];

  // Process each session that has trades in dailySummaries
  for (const day of days) {
    const date = day.day;
    const trades = tradesByDate.get(date) ?? [];
    const sentiment = sentiments.get(date) ?? null;
    const sessionPnl = pnlByDate.get(date) ?? 0;

    const violations = violationsForSession(date, trades, sentiment, rules);

    const bucket = violations.length <= 2 ? 0 : violations.length <= 5 ? 1 : 2;
    bucketAcc[bucket].count += 1;
    bucketAcc[bucket].pnlSum += sessionPnl;

    if (violations.length === 0) {
      cleanCount += 1;
      cleanPnlSum += sessionPnl;
    } else {
      violatedCount += 1;
      violatedPnlSum += sessionPnl;

      for (const v of violations) {
        const existing = byRule.get(v.rule);
        if (existing) {
          existing.violationCount += 1;
          existing.sessionsAffected.add(date);
        } else {
          byRule.set(v.rule, {
            violationCount: 1,
            sessionsAffected: new Set([date]),
            affectedPnl: 0, // computed after
          });
        }
      }

      // Add sessionPnl to every rule that fired this session (after dedup)
      const rulesFiredThisSession = new Set(violations.map((v) => v.rule));
      for (const rule of rulesFiredThisSession) {
        const acc = byRule.get(rule)!;
        acc.affectedPnl += sessionPnl;
      }
    }
  }

  // Sort by violationCount descending
  const byRuleRows: ByRuleRow[] = [...byRule.entries()]
    .map(([rule, acc]) => ({
      rule,
      title: titleByRule.get(rule) ?? RULES[rule]?.title ?? `Rule ${rule}`,
      violationCount: acc.violationCount,
      sessionsAffected: acc.sessionsAffected.size,
      affectedPnl: Math.round(acc.affectedPnl * 100) / 100,
    }))
    .sort((a, b) => b.violationCount - a.violationCount);

  return {
    cleanSessions: {
      count: cleanCount,
      avgPnl: cleanCount > 0 ? Math.round((cleanPnlSum / cleanCount) * 100) / 100 : 0,
    },
    violatedSessions: {
      count: violatedCount,
      avgPnl: violatedCount > 0 ? Math.round((violatedPnlSum / violatedCount) * 100) / 100 : 0,
    },
    buckets: bucketAcc.map((b) => ({
      label: b.label,
      count: b.count,
      avgPnl: b.count > 0 ? Math.round((b.pnlSum / b.count) * 100) / 100 : 0,
    })) as DisciplineOverview['buckets'],
    byRule: byRuleRows,
  };
}
