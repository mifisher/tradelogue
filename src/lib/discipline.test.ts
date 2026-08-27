// ── discipline.ts unit tests ─────────────────────────────────────────────────
// Tests disciplineOverview() with 2 synthetic sessions: one clean, one violated.
// Verifies the aggregate math without hitting the DB.

import { describe, it, expect } from 'vitest';
import { disciplineOverview, tradeToRuleTrade } from './discipline';
import { DEFAULT_RULE_CONFIGS, DETECTOR_TEMPLATES } from './rules';
import type { TradeRow } from './queries';
import type { DailySummary } from './queries';

// A fresh install seeds ONE rule; these tests exercise the aggregation over the
// whole detection engine, so they run against the seed plus every template.
const ALL_RULES = [...DEFAULT_RULE_CONFIGS, ...DETECTOR_TEMPLATES];

// ── Helpers ──────────────────────────────────────────────────────────────────

let idSeq = 0;
function mkRow(over: Partial<TradeRow> = {}): TradeRow {
  idSeq += 1;
  return {
    id: idSeq,
    conid: 12345,
    underlying: 'NVDA',
    description: 'NVDA 12JUN26 170.0 P',
    expiry: '2026-06-20',
    strike: 170,
    putCall: 'P',
    direction: 'long',
    status: 'closed',
    openedAt: new Date('2026-06-08T14:30:00Z'),  // 07:30 PT — fine for R21
    closedAt: new Date('2026-06-08T15:00:00Z'),
    sessionDate: '2026-06-08',
    quantityOpened: 1,
    avgEntryPrice: 1.0,           // outlay $100 — fine for R1
    avgExitPrice: 1.5,
    realizedPnl: 50,
    commissions: -0.65,
    executionIds: ['exec-1'],
    firstExecId: `exec-${idSeq}`,
    ...over,
  };
}

// ── tradeToRuleTrade ──────────────────────────────────────────────────────────

describe('tradeToRuleTrade', () => {
  it('maps TradeRow fields to RuleTrade correctly', () => {
    const row = mkRow({ firstExecId: 'e42', underlying: 'QQQ', realizedPnl: -123.45 });
    const rt = tradeToRuleTrade(row);
    expect(rt.firstExecId).toBe('e42');
    expect(rt.underlying).toBe('QQQ');
    expect(rt.expiry).toBe('2026-06-20');
    expect(rt.openedAt).toBeInstanceOf(Date);
    expect(rt.closedAt).toBeInstanceOf(Date);
    expect(rt.quantityOpened).toBe(1);
    expect(rt.avgEntryPrice).toBe(1.0);
    expect(rt.realizedPnl).toBe(-123.45);
  });

  it('falls back to id.toString() when firstExecId is null', () => {
    const row = mkRow({ firstExecId: null as unknown as string, id: 99 });
    const rt = tradeToRuleTrade(row);
    expect(rt.firstExecId).toBe('99');
  });
});

// ── disciplineOverview ────────────────────────────────────────────────────────

describe('disciplineOverview — two synthetic sessions', () => {
  // Session A (2026-06-01): clean — one trade, Bullish, no violations
  // Session B (2026-06-08): violated — Uncertain + 4 trades → the chop-day cap fires

  const cleanDate = '2026-06-01';
  const violatedDate = '2026-06-08';

  // Clean session: 1 trade, $200 P&L
  const cleanTrade = mkRow({
    sessionDate: cleanDate,
    openedAt: new Date('2026-06-01T14:30:00Z'),
    closedAt: new Date('2026-06-01T15:00:00Z'),
    realizedPnl: 200,
    firstExecId: 'clean-1',
  });

  // Violated session: 4 trades, -$120 total P&L, Uncertain sentiment → chop-day cap
  function mkUncertainTrade(n: number): TradeRow {
    return mkRow({
      sessionDate: violatedDate,
      openedAt: new Date(`2026-06-08T1${4 + n}:30:00Z`),
      closedAt: new Date(`2026-06-08T1${4 + n}:45:00Z`),
      realizedPnl: -30,
      firstExecId: `v-trade-${n}`,
    });
  }

  const violatedTrades = [1, 2, 3, 4].map(mkUncertainTrade);

  const allTrades = [cleanTrade, ...violatedTrades];

  const sentiments: Map<string, string | null> = new Map([
    [cleanDate, 'Bullish'],
    [violatedDate, 'Uncertain'],
  ]);

  const days: DailySummary[] = [
    { day: cleanDate, pnl: 200, tradeCount: 1 },
    { day: violatedDate, pnl: -120, tradeCount: 4 },
  ];

  it('counts one clean session and one violated session', () => {
    const overview = disciplineOverview(allTrades, sentiments, days, ALL_RULES);
    expect(overview.cleanSessions.count).toBe(1);
    expect(overview.violatedSessions.count).toBe(1);
  });

  it('computes avgPnl correctly for each bucket', () => {
    const overview = disciplineOverview(allTrades, sentiments, days, ALL_RULES);
    // Clean: 200 / 1 = 200
    expect(overview.cleanSessions.avgPnl).toBe(200);
    // Violated: -120 / 1 = -120
    expect(overview.violatedSessions.avgPnl).toBe(-120);
  });

  it('includes the chop-day rule in the byRule breakdown with correct counts', () => {
    const overview = disciplineOverview(allTrades, sentiments, days, ALL_RULES);
    const r15 = overview.byRule.find((r) => r.rule === 5);
    expect(r15).toBeDefined();
    expect(r15!.violationCount).toBe(1);    // 1 session-level violation
    expect(r15!.sessionsAffected).toBe(1);  // 1 session affected
    expect(r15!.affectedPnl).toBe(-120);    // P&L of the violated session
  });

  it('returns an empty byRule array for all-clean data', () => {
    const overview = disciplineOverview(
      [cleanTrade],
      new Map([[cleanDate, 'Bullish']]),
      [{ day: cleanDate, pnl: 200, tradeCount: 1 }],
      ALL_RULES,
    );
    expect(overview.byRule).toHaveLength(0);
    expect(overview.cleanSessions.count).toBe(1);
    expect(overview.violatedSessions.count).toBe(0);
    expect(overview.violatedSessions.avgPnl).toBe(0);
  });

  it('sorts byRule by violationCount descending', () => {
    // Two violated sessions: one triggers the chop-day cap, the other also triggers the chop-day cap
    // (violatedDate already trips the chop-day cap; add another uncertain session with 4 trades)
    const date2 = '2026-06-09';
    const extraTrades = [1, 2, 3, 4].map((n) =>
      mkRow({
        sessionDate: date2,
        openedAt: new Date(`2026-06-09T1${4 + n}:30:00Z`),
        closedAt: new Date(`2026-06-09T1${4 + n}:45:00Z`),
        realizedPnl: -30,
        firstExecId: `extra-${n}`,
      }),
    );

    const overview = disciplineOverview(
      [...allTrades, ...extraTrades],
      new Map([
        [cleanDate, 'Bullish'],
        [violatedDate, 'Uncertain'],
        [date2, 'Uncertain'],
      ]),
      [
        ...days,
        { day: date2, pnl: -120, tradeCount: 4 },
      ],
      ALL_RULES,
    );

    const r15 = overview.byRule.find((r) => r.rule === 5);
    expect(r15!.violationCount).toBe(2);
    expect(r15!.sessionsAffected).toBe(2);
    // byRule[0] should be the rule with highest violationCount
    expect(overview.byRule[0].violationCount).toBeGreaterThanOrEqual(
      overview.byRule[overview.byRule.length - 1].violationCount,
    );
  });

  it('buckets sessions by violation count with per-bucket avg P&L', () => {
    const cleanDate = '2026-06-01';
    const violatedDate = '2026-06-02';
    // Clean session: 1 well-behaved trade → bucket 0 (0–2 violations)
    const cleanTrades = [mkRow({ sessionDate: cleanDate })];
    // Violated session: 6 trades on an Uncertain day, all in the opening range, oversized →
    // racks up well over 6 violations → bucket 2 (6+)
    const violatedTrades = Array.from({ length: 6 }, (_, i) =>
      mkRow({
        sessionDate: violatedDate,
        underlying: `TICK${i}`,
        openedAt: new Date(`2026-06-02T13:0${i}:00Z`), // 06:0i PT — R21 each
        closedAt: new Date(`2026-06-02T13:0${i}:30Z`),
        quantityOpened: 10,
        avgEntryPrice: 2.0, // $2,000 outlay — R1 each
        realizedPnl: -10,
      }),
    );
    const overview = disciplineOverview(
      [...cleanTrades, ...violatedTrades],
      new Map([
        [cleanDate, 'Bullish'],
        [violatedDate, 'Uncertain'],
      ]),
      [
        { day: cleanDate, pnl: 100, tradeCount: 1 },
        { day: violatedDate, pnl: -500, tradeCount: 6 },
      ],
    );
    expect(overview.buckets[0]).toMatchObject({ label: '0–2 violations', count: 1, avgPnl: 100 });
    expect(overview.buckets[1]).toMatchObject({ label: '3–5 violations', count: 0, avgPnl: 0 });
    expect(overview.buckets[2]).toMatchObject({ label: '6+ violations', count: 1, avgPnl: -500 });
  });
});
