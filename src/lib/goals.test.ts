import { describe, expect, it } from 'vitest';
import {
  baselineSessions, describeCheck, evaluateGoal, isValidCheck, normalizeCheck,
  isValidDetectorThreshold, parseStartGoalInput, sessionMetrics, SELF_REPORT,
  type GoalSession, type GoalSpec,
} from './goals';
import type { RuleTrade } from './rules';

let seq = 0;
function trade(day: string, over: Partial<RuleTrade> = {}): RuleTrade {
  seq += 1;
  return {
    firstExecId: `e${seq}`, underlying: 'NVDA', expiry: '2099-01-01',
    openedAt: new Date(`${day}T15:00:00Z`), closedAt: new Date(`${day}T15:30:00Z`),
    quantityOpened: 1, avgEntryPrice: 1, realizedPnl: 50, ...over,
  };
}
function day(date: string, trades: RuleTrade[], journaled = true): GoalSession {
  return { sessionDate: date, sentiment: 'Bullish', journaled, trades };
}
const goal = (over: Partial<GoalSpec> = {}): GoalSpec => ({
  checkType: 'max-trades-per-session', threshold: 3, targetSessions: 10,
  startedAt: new Date('2026-10-01T00:00:00Z'), ...over,
});

describe('checks', () => {
  it('rejects nonsense thresholds', () => {
    expect(isValidCheck({ type: 'daily-loss-stop', threshold: 300 })).toBe(false);
    expect(isValidCheck({ type: 'daily-loss-stop', threshold: -300 })).toBe(true);
    expect(isValidCheck({ type: 'max-trades-per-session', threshold: 0 })).toBe(false);
    expect(isValidCheck({ type: 'max-trades-per-session', threshold: 2.5 })).toBe(false);
    expect(isValidCheck({ type: 'no-zero-dte', threshold: 5 })).toBe(false);
  });
  it('normalizes missing or bad AI output to self-report', () => {
    expect(normalizeCheck(undefined)).toEqual(SELF_REPORT);
    expect(normalizeCheck({ type: 'made-up', threshold: 1 })).toEqual(SELF_REPORT);
    expect(normalizeCheck({ type: 'daily-loss-stop', threshold: 300 })).toEqual(SELF_REPORT);
    expect(normalizeCheck({ type: 'no-zero-dte', threshold: 5 })).toEqual({ type: 'no-zero-dte', threshold: null });
    expect(normalizeCheck({ type: 'max-outlay-per-trade', threshold: 500 })).toEqual({ type: 'max-outlay-per-trade', threshold: 500 });
  });
  it('describes checks in plain words', () => {
    expect(describeCheck({ type: 'max-trades-per-session', threshold: 3 })).toBe('≤ 3 trades/session');
    expect(describeCheck({ type: 'max-outlay-per-trade', threshold: 500 })).toBe('≤ $500 outlay per trade');
    expect(describeCheck({ type: 'daily-loss-stop', threshold: -300 })).toBe('Stop at −$300 on the day');
    // vitest pins TRADING_TIMEZONE to America/New_York, so market and local time match
    expect(describeCheck({ type: 'no-entries-before', threshold: 30 }, '2026-06-08'))
      .toBe('No entries in the first 30 min (until 10:00 AM EDT)');
  });
  it('parseStartGoalInput rejects a threshold that does not fit the check', () => {
    const base = { title: 't', hypothesis: 'h', protocol: 'p', successMetric: 's', targetSessions: 10 };
    expect(() => parseStartGoalInput({ ...base, check: { type: 'daily-loss-stop', threshold: 300 } }))
      .toThrow(/threshold/i);
    expect(parseStartGoalInput({ ...base, check: { type: 'daily-loss-stop', threshold: -300 } }).check.threshold).toBe(-300);
    expect(() => parseStartGoalInput({ ...base, targetSessions: 0, check: SELF_REPORT })).toThrow();
  });
});

describe('evaluateGoal', () => {
  it('counts journaled traded sessions after the start; hit when under the cap, miss with reason', () => {
    const sessions = [
      day('2026-10-02', [trade('2026-10-02'), trade('2026-10-02')]),
      day('2026-10-03', [trade('2026-10-03'), trade('2026-10-03'), trade('2026-10-03'), trade('2026-10-03')]),
    ];
    const ev = evaluateGoal(goal(), sessions, new Map());
    expect(ev.counted).toBe(2);
    expect(ev.hits).toBe(1);
    expect(ev.results[0]).toEqual({ sessionDate: '2026-10-02', hit: true, reason: null });
    expect(ev.results[1]).toMatchObject({ sessionDate: '2026-10-03', hit: false, reason: '4 trades, limit 3.' });
    expect(ev.finished).toBe(false);
  });

  it('ignores no-trade days and lists traded-but-unjournaled days as awaiting', () => {
    const ev = evaluateGoal(goal(), [
      day('2026-10-02', []),
      day('2026-10-03', [trade('2026-10-03')], false),
    ], new Map());
    expect(ev.counted).toBe(0);
    expect(ev.awaitingJournal).toEqual(['2026-10-03']);
  });

  it('start-day session that opened before the goal belongs to baseline, not the goal', () => {
    const startedAt = new Date('2026-10-02T18:00:00Z'); // started after the morning's trades
    const sessions = [day('2026-10-02', [trade('2026-10-02')])];
    expect(evaluateGoal(goal({ startedAt }), sessions, new Map()).counted).toBe(0);
    expect(baselineSessions(goal({ startedAt }), sessions).sessions.map((s) => s.sessionDate)).toEqual(['2026-10-02']);
  });

  it('stops at targetSessions and marks finished; extending raises the target', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => {
      const d = `2026-10-${String(i + 2).padStart(2, '0')}`;
      return day(d, [trade(d)]);
    });
    const ev = evaluateGoal(goal(), sessions, new Map());
    expect(ev.counted).toBe(10);
    expect(ev.finished).toBe(true);
    expect(evaluateGoal(goal({ targetSessions: 20 }), sessions, new Map())).toMatchObject({ counted: 12, finished: false });
  });

  it('self-report: false is a miss, unanswered is not counted', () => {
    const g = goal({ checkType: 'self-report', threshold: null });
    const sessions = [day('2026-10-02', [trade('2026-10-02')]), day('2026-10-03', [trade('2026-10-03')])];
    const ev = evaluateGoal(g, sessions, new Map([['2026-10-02', false]]));
    expect(ev.counted).toBe(1);
    expect(ev.results[0]).toMatchObject({ hit: false });
    expect(ev.awaitingJournal).toEqual(['2026-10-03']);
  });
});

describe('baseline & metrics', () => {
  it('takes the last N counted sessions before the start, flags short history', () => {
    const before = ['2026-09-28', '2026-09-29', '2026-09-30'].map((d) => day(d, [trade(d)]));
    const b = baselineSessions(goal({ targetSessions: 2 }), [...before, day('2026-09-27', [trade('2026-09-27')], false)]);
    expect(b.sessions.map((s) => s.sessionDate)).toEqual(['2026-09-29', '2026-09-30']);
    expect(b.short).toBe(false);
    expect(baselineSessions(goal({ targetSessions: 10 }), before).short).toBe(true);
  });

  it('computes day win rate, avg P&L, expectancy, avg trades', () => {
    const m = sessionMetrics([
      day('2026-10-02', [trade('2026-10-02', { realizedPnl: 100 }), trade('2026-10-02', { realizedPnl: -40 })]),
      day('2026-10-03', [trade('2026-10-03', { realizedPnl: -20 })]),
    ]);
    expect(m).toEqual({ sessions: 2, dayWinRate: 0.5, avgPnl: 20, expectancy: 13.33, avgTrades: 1.5 });
  });
});

describe('closed goals', () => {
  it('stop counting sessions after closedOn', () => {
    const sessions = ['2026-10-02', '2026-10-03', '2026-10-06'].map((d) => day(d, [trade(d)]));
    const ev = evaluateGoal(goal({ checkType: 'self-report', threshold: null, closedOn: '2026-10-03' }), sessions, new Map([['2026-10-02', true]]));
    expect(ev.results.map((r) => r.sessionDate)).toEqual(['2026-10-02']);
    expect(ev.awaitingJournal).toEqual(['2026-10-03']); // on the close day, still in range
  });
});

describe('isValidDetectorThreshold', () => {
  it('applies the goal check bounds to rule thresholds', () => {
    expect(isValidDetectorThreshold('max-trades-per-session', 0)).toBe(false);
    expect(isValidDetectorThreshold('circuit-breaker', 500)).toBe(false);
    expect(isValidDetectorThreshold('circuit-breaker', -500)).toBe(true);
    expect(isValidDetectorThreshold('zero-dte', 5)).toBe(false);
    expect(isValidDetectorThreshold('chop-trade-cap', 3)).toBe(false); // no goal check exposes it
    expect(isValidDetectorThreshold(null, 5)).toBe(false);
    expect(isValidDetectorThreshold('oversized-outlay', null)).toBe(true); // null = default
  });
});
