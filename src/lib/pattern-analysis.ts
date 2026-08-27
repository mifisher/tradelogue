import { z } from 'zod';
import { fmtMoney, fmtPct } from './format';

export const PatternInsightSchema = z.object({
  title: z.string(),
  why: z.string(),
  action: z.string(),
  evidence: z.array(z.string()),
});

export const PatternExperimentSchema = z.object({
  title: z.string(),
  hypothesis: z.string(),
  protocol: z.string(),
  successMetric: z.string(),
});

export const PatternAnalysisOutputSchema = z.object({
  summary: z.string(),
  topFocusAreas: z.array(PatternInsightSchema).min(1).max(5),
  strengthsToLeanInto: z.array(PatternInsightSchema).max(6),
  recurringMistakes: z.array(PatternInsightSchema).max(8),
  blindSpots: z.array(PatternInsightSchema).max(6),
  nextExperiments: z.array(PatternExperimentSchema).max(6),
});

export type PatternInsight = z.infer<typeof PatternInsightSchema>;
export type PatternExperiment = z.infer<typeof PatternExperimentSchema>;
export type PatternAnalysisOutput = z.infer<typeof PatternAnalysisOutputSchema>;

export interface PatternAnalysisContextInput {
  dateRange: { from: string; to: string };
  /** The trader's live rulebook — user-managed, so it is passed in rather than
   *  read from a build-time constant. */
  rulebook: Array<{ rule: number; title: string; description: string }>;
  allTime: {
    sessions: number;
    trades: number;
    totalPnl: number;
    winRateDays: number;
    profitFactor: number | null;
    expectancy: number;
    avgWin: number | null;
    avgLoss: number | null;
  };
  daily: Array<{
    day: string;
    pnl: number;
    tradeCount: number;
    sentiment: string | null;
    mood: string | null;
    sleepScore: number | null;
    sleepMinutes: number | null;
    marketContext: string | null;
    recap: string | null;
    violationCount: number;
    violationTitles: string[];
  }>;
  ruleStats: Array<{
    rule: number;
    title: string;
    violationCount: number;
    sessionsAffected: number;
    affectedPnl: number;
  }>;
  setupStats: PatternSegmentStat[];
  segmentStats: {
    byTicker: PatternSegmentStat[];
    bySentiment: PatternSegmentStat[];
    byEntryHour: PatternSegmentStat[];
  };
  annotatedTrades: Array<{
    day: string;
    timePT: string;
    ticker: string;
    direction: string;
    pnl: number;
    setupName: string | null;
    grade: string | null;
    thesis: string | null;
    executionNotes: string | null;
  }>;
}

export interface PatternSegmentStat {
  label: string;
  trades: number;
  winRate: number;
  totalPnl: number;
  expectancy: number;
}

function nullableText(value: string | number | null | undefined): string {
  return value == null || value === '' ? '(not recorded)' : String(value);
}

function sleepText(score: number | null, minutes: number | null): string {
  if (score == null && minutes == null) return '(not recorded)';
  const scoreText = score == null ? 'score not recorded' : `score ${score}`;
  const minutesText = minutes == null
    ? 'duration not recorded'
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${scoreText}, ${minutesText}`;
}

function segmentLines(rows: PatternSegmentStat[]): string[] {
  if (rows.length === 0) return ['(none)'];
  return rows.map(
    (row) =>
      `- ${row.label}: ${row.trades} trades | win rate ${fmtPct(row.winRate)} | P&L ${fmtMoney(row.totalPnl)} | expectancy ${fmtMoney(row.expectancy)}`,
  );
}

export function buildPatternAnalysisContext(input: PatternAnalysisContextInput): string {
  const lines: string[] = [];
  const { allTime } = input;

  lines.push('## Date range');
  lines.push(`${input.dateRange.from} to ${input.dateRange.to}`);
  lines.push('');

  lines.push('## All-time summary');
  lines.push(`Sessions: ${allTime.sessions}`);
  lines.push(`Trades: ${allTime.trades}`);
  lines.push(`Total P&L: ${fmtMoney(allTime.totalPnl)}`);
  lines.push(`Day win rate: ${fmtPct(allTime.winRateDays)}`);
  lines.push(`Profit factor: ${allTime.profitFactor == null ? 'N/A' : allTime.profitFactor.toFixed(2)}`);
  lines.push(`Expectancy: ${fmtMoney(allTime.expectancy)}`);
  lines.push(`Average win: ${allTime.avgWin == null ? 'N/A' : fmtMoney(allTime.avgWin)}`);
  lines.push(`Average loss: ${allTime.avgLoss == null ? 'N/A' : fmtMoney(allTime.avgLoss)}`);
  lines.push('');

  // The rulebook travels with the context, not the system prompt: rules are
  // user-managed, so a module-load constant would grade against a stale list.
  lines.push("## Trader's rulebook (numbered rules)");
  if (input.rulebook.length === 0) {
    lines.push('The trader has not written any rules yet. Do not cite rule numbers.');
  } else {
    for (const r of input.rulebook) {
      lines.push(`- Rule ${r.rule} — ${r.title}: ${r.description}`);
    }
  }
  lines.push('');

  lines.push('## Rule violation evidence');
  if (input.ruleStats.length === 0) {
    lines.push('No rule violations detected.');
  } else {
    for (const rule of input.ruleStats) {
      lines.push(
        `- Rule ${rule.rule} — ${rule.title}: ${rule.violationCount} violations across ${rule.sessionsAffected} sessions | affected P&L ${fmtMoney(rule.affectedPnl)}`,
      );
    }
  }
  lines.push('');

  lines.push('## Setup performance');
  lines.push(...segmentLines(input.setupStats));
  lines.push('');

  lines.push('## Segment performance');
  lines.push('By ticker');
  lines.push(...segmentLines(input.segmentStats.byTicker));
  lines.push('By sentiment');
  lines.push(...segmentLines(input.segmentStats.bySentiment));
  lines.push('By entry hour');
  lines.push(...segmentLines(input.segmentStats.byEntryHour));
  lines.push('');

  lines.push('## Session scorecard');
  if (input.daily.length === 0) {
    lines.push('(no sessions)');
  } else {
    for (const day of input.daily) {
      const violations = day.violationTitles.length
        ? day.violationTitles.join('; ')
        : 'none detected';
      lines.push(
        `- ${day.day}: ${fmtMoney(day.pnl)} | ${day.tradeCount} trades | sentiment ${nullableText(day.sentiment)} | sleep ${sleepText(day.sleepScore, day.sleepMinutes)} | violations ${day.violationCount} (${violations})`,
      );
      lines.push(`  mood: ${nullableText(day.mood)}`);
      lines.push(`  market context: ${nullableText(day.marketContext)}`);
      lines.push(`  recap: ${nullableText(day.recap)}`);
    }
  }
  lines.push('');

  lines.push('## Annotated trade notes');
  if (input.annotatedTrades.length === 0) {
    lines.push('(no annotated trades)');
  } else {
    for (const trade of input.annotatedTrades) {
      lines.push(
        `- ${trade.day} ${trade.timePT} PT | ${trade.ticker} ${trade.direction} | ${fmtMoney(trade.pnl)} | ${nullableText(trade.setupName)} | grade ${nullableText(trade.grade)}`,
      );
      lines.push(`  thesis: ${nullableText(trade.thesis)}`);
      lines.push(`  execution: ${nullableText(trade.executionNotes)}`);
    }
  }

  return lines.join('\n');
}

export function patternFocusPreview(
  analysis: Pick<PatternAnalysisOutput, 'topFocusAreas'> | null,
  limit = 3,
): PatternInsight[] {
  return analysis?.topFocusAreas.slice(0, limit) ?? [];
}
