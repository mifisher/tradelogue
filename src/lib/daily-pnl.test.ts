import { describe, it, expect } from 'vitest';
import { sessionDate, dailyPnl } from './daily-pnl';
import type { Trade } from './types';

function trade(over: Partial<Trade>): Trade {
  return {
    conid: 100, underlying: 'NVDA', description: 'x', expiry: null, strike: null, putCall: null,
    direction: 'long', status: 'closed',
    openedAt: new Date('2026-06-08T13:30:00Z'), closedAt: new Date('2026-06-08T14:00:00Z'),
    quantityOpened: 1, avgEntryPrice: 1, avgExitPrice: 1.1,
    realizedPnl: 10, commissions: -1, executionIds: ['e1'],
    ...over,
  };
}

describe('sessionDate', () => {
  it('converts UTC instants to Pacific calendar dates', () => {
    // 02:00 UTC Jun 9 == 19:00 PDT Jun 8 — still the Jun 8 session
    expect(sessionDate(new Date('2026-06-09T02:00:00Z'))).toBe('2026-06-08');
    expect(sessionDate(new Date('2026-06-09T14:00:00Z'))).toBe('2026-06-09');
  });
});

describe('dailyPnl', () => {
  it('sums closed-trade P&L per PT session date, skipping open trades', () => {
    const days = dailyPnl([
      trade({ realizedPnl: 100.1 }),
      trade({ realizedPnl: -37.5 }),
      trade({ realizedPnl: 50, closedAt: new Date('2026-06-09T14:00:00Z') }),
      trade({ status: 'open', closedAt: null, realizedPnl: null }),
    ]);
    expect(days.get('2026-06-08')).toBe(62.6);
    expect(days.get('2026-06-09')).toBe(50);
    expect(days.size).toBe(2);
  });
});
