import { describe, it, expect } from 'vitest';
import {
  computeStats, equityCurve, dayStreaks, groupStats,
  byTicker, byDayOfWeek, byEntryHour, byHoldTime,
  type StatTrade,
} from './stats';

function t(over: Partial<StatTrade>): StatTrade {
  return {
    underlying: 'NVDA', direction: 'long',
    openedAt: new Date('2026-06-08T13:35:00Z'), // 06:35 PT, Monday
    closedAt: new Date('2026-06-08T14:10:00Z'),
    sessionDate: '2026-06-08', quantityOpened: 2, realizedPnl: 100,
    ...over,
  };
}

describe('computeStats', () => {
  it('computes win rate, averages, profit factor, expectancy', () => {
    const s = computeStats([
      t({ realizedPnl: 100 }), t({ realizedPnl: 50 }),
      t({ realizedPnl: -75 }), t({ realizedPnl: 0 }),
    ]);
    expect(s.tradeCount).toBe(4);
    expect(s.winCount).toBe(2);          // pnl > 0 is a win; 0 counts as a loss-side scratch
    expect(s.lossCount).toBe(2);
    expect(s.winRate).toBeCloseTo(0.5);
    expect(s.totalPnl).toBe(75);
    expect(s.avgWin).toBe(75);
    expect(s.avgLoss).toBe(-37.5);
    expect(s.profitFactor).toBe(2);      // 150 / 75
    expect(s.expectancy).toBeCloseTo(18.75);
    expect(s.largestWin).toBe(100);
    expect(s.largestLoss).toBe(-75);
  });
  it('handles empty input and no-loss edge', () => {
    expect(computeStats([]).tradeCount).toBe(0);
    expect(computeStats([]).winRate).toBe(0);
    expect(computeStats([t({ realizedPnl: 10 })]).profitFactor).toBeNull();
    expect(computeStats([t({ realizedPnl: 10 })]).avgLoss).toBeNull();
  });
});

describe('equityCurve', () => {
  it('accumulates daily pnl in date order', () => {
    expect(equityCurve([
      { day: '2026-06-09', pnl: -30 },
      { day: '2026-06-08', pnl: 100 },
    ])).toEqual([
      { day: '2026-06-08', pnl: 100, cumPnl: 100 },
      { day: '2026-06-09', pnl: -30, cumPnl: 70 },
    ]);
  });
});

describe('dayStreaks', () => {
  it('tracks current and best/worst day streaks by sign', () => {
    const s = dayStreaks([
      { day: 'd1', pnl: 10 }, { day: 'd2', pnl: 5 }, { day: 'd3', pnl: -1 },
      { day: 'd4', pnl: 2 }, { day: 'd5', pnl: 3 }, { day: 'd6', pnl: 4 },
    ]);
    expect(s.bestGreenStreak).toBe(3);
    expect(s.worstRedStreak).toBe(1);
    expect(s.current).toBe(3); // positive = green streak ongoing
  });
});

describe('groupStats + keyers', () => {
  it('groups by ticker', () => {
    const g = groupStats([t({ underlying: 'NVDA' }), t({ underlying: 'TSLA', realizedPnl: -20 })], byTicker);
    expect(g.get('NVDA')!.totalPnl).toBe(100);
    expect(g.get('TSLA')!.totalPnl).toBe(-20);
  });
  it('keys day-of-week and entry hour in the trading timezone', () => {
    const trade = t({});  // 2026-06-08T13:35Z = Monday 09:35 ET
    expect(byDayOfWeek(trade)).toBe('Mon');
    expect(byEntryHour(trade)).toBe('9 AM');
  });
  it('buckets hold time', () => {
    expect(byHoldTime(t({}))).toBe('30–60m'); // 35 minutes
    expect(byHoldTime(t({ closedAt: new Date('2026-06-08T13:38:00Z') }))).toBe('<5m');
    expect(byHoldTime(t({ closedAt: new Date('2026-06-08T15:00:00Z') }))).toBe('1h+');
  });
});
