import { db } from '@/db';
import { sessions } from '@/db/schema';
import {
  closedTrades,
  dailySummaries,
  getAnnotationsByExecIds,
  getSetups,
  sentimentByDate,
  toStatTrade,
  tradesForAllSetups,
  type TradeRow,
} from '@/lib/queries';
import { disciplineOverview, violationsForSession } from '@/lib/discipline';
import {
  byEntryHour,
  byTicker,
  computeStats,
  groupStats,
  type StatTrade,
} from '@/lib/stats';
import {
  buildPatternAnalysisContext,
  type PatternAnalysisContextInput,
  type PatternSegmentStat,
} from '@/lib/pattern-analysis';
import { getRuleConfigs } from '@/lib/trading-rules';
import { TRADING_TIMEZONE } from '@/lib/config';

const TZ_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const MAX_ANNOTATED_TRADES = 120;

export interface PatternAnalysisContextBundle {
  context: string;
  meta: {
    from: string;
    to: string;
    sessions: number;
    trades: number;
    totalPnl: number;
  };
}

function toSegmentStats(map: Map<string, ReturnType<typeof computeStats>>, limit = 12): PatternSegmentStat[] {
  return [...map.entries()]
    .map(([label, stats]) => ({
      label,
      trades: stats.tradeCount,
      winRate: stats.winRate,
      totalPnl: stats.totalPnl,
      expectancy: stats.expectancy,
    }))
    .sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))
    .slice(0, limit);
}

function sentimentGroupStats(
  statTrades: StatTrade[],
  sentiments: Map<string, string | null>,
): PatternSegmentStat[] {
  const grouped = new Map<string, StatTrade[]>();
  for (const trade of statTrades) {
    const label = sentiments.get(trade.sessionDate) ?? 'Unjournaled';
    const rows = grouped.get(label) ?? [];
    rows.push(trade);
    grouped.set(label, rows);
  }
  return toSegmentStats(
    new Map([...grouped.entries()].map(([label, rows]) => [label, computeStats(rows)])),
  );
}

function groupTradesByDate(rows: TradeRow[]): Map<string, TradeRow[]> {
  const grouped = new Map<string, TradeRow[]>();
  for (const row of rows) {
    if (!row.sessionDate) continue;
    const existing = grouped.get(row.sessionDate) ?? [];
    existing.push(row);
    grouped.set(row.sessionDate, existing);
  }
  return grouped;
}

export async function assemblePatternAnalysisContext(): Promise<PatternAnalysisContextBundle> {
  const [tradeRows, days, sessionRows, setupRows, setupTradesMap, sentiments, ruleConfigs] = await Promise.all([
    closedTrades(),
    dailySummaries(),
    db.select().from(sessions),
    getSetups(),
    tradesForAllSetups(),
    sentimentByDate(),
    getRuleConfigs(),
  ]);

  const sortedDays = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const dateRange = {
    from: sortedDays[0]?.day ?? 'n/a',
    to: sortedDays[sortedDays.length - 1]?.day ?? 'n/a',
  };
  const sessionByDate = new Map(sessionRows.map((row) => [row.sessionDate, row]));
  const tradesByDate = groupTradesByDate(tradeRows);
  const statTrades = tradeRows.map(toStatTrade);
  const allTime = computeStats(statTrades);
  const discipline = disciplineOverview(tradeRows, sentiments, days, ruleConfigs);

  const setupStats: PatternSegmentStat[] = [];
  for (const setup of setupRows) {
    const setupTrades = setupTradesMap.get(setup.number) ?? [];
    if (setupTrades.length === 0) continue;
    const stats = computeStats(setupTrades.map(toStatTrade));
    setupStats.push({
      label: `${setup.number} — ${setup.name}`,
      trades: stats.tradeCount,
      winRate: stats.winRate,
      totalPnl: stats.totalPnl,
      expectancy: stats.expectancy,
    });
  }
  setupStats.sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl));

  const daily: PatternAnalysisContextInput['daily'] = sortedDays.map((day) => {
    const session = sessionByDate.get(day.day);
    const dayTrades = tradesByDate.get(day.day) ?? [];
    const violations = violationsForSession(day.day, dayTrades, session?.sentiment ?? null, ruleConfigs);
    return {
      day: day.day,
      pnl: day.pnl,
      tradeCount: day.tradeCount,
      sentiment: session?.sentiment ?? null,
      mood: session?.mood ?? null,
      sleepScore: session?.sleepScore ?? null,
      sleepMinutes: session?.sleepMinutes ?? null,
      marketContext: session?.marketContext ?? null,
      recap: session?.recap ?? null,
      violationCount: violations.length,
      violationTitles: [...new Set(violations.map((v) => v.title))],
    };
  });

  const execIds = tradeRows
    .map((row) => row.firstExecId)
    .filter((id): id is string => id != null);
  const annotations = await getAnnotationsByExecIds(execIds);
  const annotatedTrades = [...tradeRows]
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
    .flatMap((row) => {
      const annotation = row.firstExecId ? annotations.get(row.firstExecId) : null;
      if (!annotation?.thesis && !annotation?.executionNotes && !annotation?.grade) return [];
      return [{
        day: row.sessionDate ?? 'unknown',
        timePT: TZ_TIME.format(row.openedAt),
        ticker: row.underlying,
        direction: row.direction,
        pnl: row.realizedPnl ?? 0,
        setupName: annotation?.setupNumber != null ? `Setup ${annotation.setupNumber}` : null,
        grade: annotation?.grade ?? null,
        thesis: annotation?.thesis ?? null,
        executionNotes: annotation?.executionNotes ?? null,
      }];
    })
    .slice(0, MAX_ANNOTATED_TRADES);

  const input: PatternAnalysisContextInput = {
    dateRange,
    rulebook: ruleConfigs
      .filter((r) => r.enabled)
      .map((r) => ({ rule: r.rule, title: r.title, description: r.description })),
    allTime: {
      sessions: sortedDays.length,
      trades: allTime.tradeCount,
      totalPnl: allTime.totalPnl,
      winRateDays: sortedDays.length
        ? sortedDays.filter((day) => day.pnl > 0).length / sortedDays.length
        : 0,
      profitFactor: allTime.profitFactor,
      expectancy: allTime.expectancy,
      avgWin: allTime.avgWin,
      avgLoss: allTime.avgLoss,
    },
    daily,
    ruleStats: discipline.byRule,
    setupStats,
    segmentStats: {
      byTicker: toSegmentStats(groupStats(statTrades, byTicker)),
      bySentiment: sentimentGroupStats(statTrades, sentiments),
      byEntryHour: toSegmentStats(groupStats(statTrades, byEntryHour)),
    },
    annotatedTrades,
  };

  return {
    context: buildPatternAnalysisContext(input),
    meta: {
      from: dateRange.from,
      to: dateRange.to,
      sessions: sortedDays.length,
      trades: allTime.tradeCount,
      totalPnl: allTime.totalPnl,
    },
  };
}
