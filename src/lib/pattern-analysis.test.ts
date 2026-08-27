import { describe, expect, it } from 'vitest';
import {
  buildPatternAnalysisContext,
  patternFocusPreview,
  type PatternAnalysisContextInput,
  type PatternAnalysisOutput,
} from './pattern-analysis';

const BASE_INPUT: PatternAnalysisContextInput = {
  rulebook: [
    { rule: 1, title: 'Maximum position outlay', description: 'Position cost must not exceed the cap.' },
  ],
  dateRange: { from: '2026-06-01', to: '2026-06-18' },
  allTime: {
    sessions: 3,
    trades: 7,
    totalPnl: -197.5,
    winRateDays: 2 / 3,
    profitFactor: 0.84,
    expectancy: -28.21,
    avgWin: 221.5,
    avgLoss: -310.25,
  },
  daily: [
    {
      day: '2026-06-01',
      pnl: -724.4,
      tradeCount: 4,
      sentiment: 'Bullish',
      mood: 'distracted',
      sleepScore: 75,
      sleepMinutes: 297,
      marketContext: 'Choppy gap-up open.',
      recap: '0DTE AVGO drove the loss.',
      violationCount: 2,
      violationTitles: ['0DTE contracts', 'Pre-7 AM entry'],
    },
    {
      day: '2026-06-10',
      pnl: 345.78,
      tradeCount: 1,
      sentiment: 'Bearish',
      mood: 'measured',
      sleepScore: 73,
      sleepMinutes: 309,
      marketContext: 'CPI day.',
      recap: 'One-and-done HOOD trade.',
      violationCount: 0,
      violationTitles: [],
    },
    {
      day: '2026-06-18',
      pnl: 181.12,
      tradeCount: 2,
      sentiment: 'Uncertain',
      mood: null,
      sleepScore: null,
      sleepMinutes: null,
      marketContext: null,
      recap: null,
      violationCount: 1,
      violationTitles: ['Entry before confirmation'],
    },
  ],
  ruleStats: [
    { rule: 13, title: 'No 0DTE contracts', violationCount: 3, sessionsAffected: 2, affectedPnl: -837.04 },
    { rule: 21, title: 'Pre-7 AM confirmation', violationCount: 2, sessionsAffected: 2, affectedPnl: -543.28 },
  ],
  setupStats: [
    { label: '2 — Breakout', trades: 4, winRate: 0.75, totalPnl: 812.12, expectancy: 203.03 },
    { label: '4 — Reclaim', trades: 3, winRate: 0.33, totalPnl: -402.5, expectancy: -134.17 },
  ],
  segmentStats: {
    byTicker: [
      { label: 'HOOD', trades: 2, winRate: 1, totalPnl: 526.9, expectancy: 263.45 },
    ],
    bySentiment: [
      { label: 'Bullish', trades: 4, winRate: 0.25, totalPnl: -724.4, expectancy: -181.1 },
    ],
    byEntryHour: [
      { label: '6 AM', trades: 3, winRate: 0, totalPnl: -612.5, expectancy: -204.17 },
    ],
  },
  annotatedTrades: [
    {
      day: '2026-06-10',
      timePT: '07:19',
      ticker: 'HOOD',
      direction: 'long',
      pnl: 345.78,
      setupName: 'Setup 2',
      grade: 'A-',
      thesis: 'Relative strength breakout.',
      executionNotes: 'Waited until after 7 AM and stopped after the win.',
    },
  ],
};

describe('buildPatternAnalysisContext', () => {
  it('formats cross-trade evidence for recurring pattern synthesis', () => {
    const context = buildPatternAnalysisContext(BASE_INPUT);

    expect(context).toContain('## Date range');
    expect(context).toContain('2026-06-01 to 2026-06-18');
    expect(context).toContain('Total P&L: -$197.50');
    expect(context).toContain('Rule 13 — No 0DTE contracts');
    expect(context).toContain('2 — Breakout');
    expect(context).toContain('6 AM');
    expect(context).toContain('Relative strength breakout.');
  });
});

describe('patternFocusPreview', () => {
  it('returns the first three dashboard focus areas', () => {
    const analysis: PatternAnalysisOutput = {
      summary: 'Focus on rule adherence.',
      topFocusAreas: [
        { title: 'Stop 0DTE substitutions', why: 'They drive large losses.', action: 'Pass when the right expiry is too expensive.', evidence: ['$837 loss cluster'] },
        { title: 'Wait past the open', why: '6 AM entries underperform.', action: 'Require VWAP confirmation.', evidence: ['6 AM negative expectancy'] },
        { title: 'Protect one-and-done wins', why: 'Follow-up trades give back gains.', action: 'End after first A trade on chop days.', evidence: ['HOOD one trade day'] },
        { title: 'Keep runners on 5-min EMA', why: 'Premature exits cap wins.', action: 'Use 5-min only.', evidence: ['A- runners'] },
      ],
      strengthsToLeanInto: [],
      recurringMistakes: [],
      blindSpots: [],
      nextExperiments: [],
    };

    expect(patternFocusPreview(analysis)).toEqual([
      analysis.topFocusAreas[0],
      analysis.topFocusAreas[1],
      analysis.topFocusAreas[2],
    ]);
  });
});
