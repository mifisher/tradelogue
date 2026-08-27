import { describe, it, expect } from 'vitest';
import { buildTrades, round2 } from './trade-builder';
import type { Execution } from './types';

let seq = 0;
function fill(over: Partial<Execution>): Execution {
  seq += 1;
  return {
    execId: `e${seq}`,
    accountId: 'U1',
    conid: 100,
    underlying: 'NVDA',
    description: 'NVDA 12JUN26 170.0 P',
    assetCategory: 'OPT',
    expiry: '2026-06-12',
    strike: 170,
    putCall: 'P',
    multiplier: 100,
    dateTime: new Date('2026-06-08T13:35:00Z'),
    quantity: 1,
    price: 1,
    proceeds: -100,
    commission: -0.65,
    raw: {},
    ...over,
  };
}

describe('buildTrades — basic round trip', () => {
  it('pairs a buy and a sell into one closed long trade with P&L', () => {
    const trades = buildTrades([
      fill({ quantity: 2, price: 1.55, proceeds: -310, commission: -1.3, dateTime: new Date('2026-06-08T13:35:00Z') }),
      fill({ quantity: -2, price: 2.05, proceeds: 410, commission: -1.3, dateTime: new Date('2026-06-08T14:10:00Z') }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      direction: 'long',
      status: 'closed',
      quantityOpened: 2,
      avgEntryPrice: 1.55,
      avgExitPrice: 2.05,
      realizedPnl: 97.4, // 410 - 310 - 2.60
      commissions: -2.6,
    });
    expect(trades[0].closedAt?.toISOString()).toBe('2026-06-08T14:10:00.000Z');
  });
});

describe('buildTrades — scaling and re-entry', () => {
  it('handles scale-out partials as one trade (buy 6, sell 2/2/2)', () => {
    const trades = buildTrades([
      fill({ quantity: 6, price: 1.0, proceeds: -600, commission: -3.9, dateTime: new Date('2026-06-08T13:35:00Z') }),
      fill({ quantity: -2, price: 1.1, proceeds: 220, commission: -1.3, dateTime: new Date('2026-06-08T13:50:00Z') }),
      fill({ quantity: -2, price: 1.2, proceeds: 240, commission: -1.3, dateTime: new Date('2026-06-08T14:05:00Z') }),
      fill({ quantity: -2, price: 1.5, proceeds: 300, commission: -1.3, dateTime: new Date('2026-06-08T14:30:00Z') }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].quantityOpened).toBe(6);
    expect(trades[0].avgExitPrice).toBeCloseTo(1.27, 2);
    expect(trades[0].realizedPnl).toBe(152.2); // 760 - 600 - 7.80
  });

  it('separates two round trips on the same contract into two trades', () => {
    const trades = buildTrades([
      fill({ quantity: 2, proceeds: -200, dateTime: new Date('2026-06-08T13:35:00Z') }),
      fill({ quantity: -2, proceeds: 180, dateTime: new Date('2026-06-08T13:45:00Z') }),
      fill({ quantity: 3, proceeds: -330, dateTime: new Date('2026-06-08T15:00:00Z') }),
      fill({ quantity: -3, proceeds: 390, dateTime: new Date('2026-06-08T15:20:00Z') }),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0].realizedPnl).toBe(round2(-20 - 1.3));
    expect(trades[1].realizedPnl).toBe(round2(60 - 1.3));
  });
});

describe('buildTrades — edge cases', () => {
  it('leaves an unmatched position as an open trade with null realizedPnl', () => {
    const trades = buildTrades([
      fill({ quantity: 2, proceeds: -200 }),
      fill({ quantity: -1, proceeds: 110, dateTime: new Date('2026-06-08T14:00:00Z') }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].status).toBe('open');
    expect(trades[0].realizedPnl).toBeNull();
    expect(trades[0].closedAt).toBeNull();
  });

  it('treats a zero-price expiry fill as a closing execution (0DTE expires worthless)', () => {
    const trades = buildTrades([
      fill({ quantity: 3, price: 0.8, proceeds: -240, commission: -1.95 }),
      fill({ quantity: -3, price: 0, proceeds: 0, commission: 0, dateTime: new Date('2026-06-08T20:00:00Z') }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].status).toBe('closed');
    expect(trades[0].realizedPnl).toBe(-241.95);
  });

  it('builds short trades (sell to open)', () => {
    const trades = buildTrades([
      fill({ quantity: -2, price: 1.5, proceeds: 300, commission: -1.3 }),
      fill({ quantity: 2, price: 1.0, proceeds: -200, commission: -1.3, dateTime: new Date('2026-06-08T14:00:00Z') }),
    ]);
    expect(trades[0].direction).toBe('short');
    expect(trades[0].realizedPnl).toBe(97.4);
  });

  it('splits a fill that crosses zero into a close and a new open', () => {
    const trades = buildTrades([
      fill({ quantity: 2, price: 1.0, proceeds: -200, commission: -1.3 }),
      fill({ quantity: -5, price: 1.2, proceeds: 600, commission: -3.25, dateTime: new Date('2026-06-08T14:00:00Z') }),
      fill({ quantity: 3, price: 1.1, proceeds: -330, commission: -1.95, dateTime: new Date('2026-06-08T14:30:00Z') }),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0].status).toBe('closed');
    expect(trades[0].direction).toBe('long');
    expect(trades[0].realizedPnl).toBe(round2(-200 + 240 - 1.3 - 1.3)); // 2 of the 5 sold @1.2, 2/5 of commission
    expect(trades[1].direction).toBe('short');
    expect(trades[1].status).toBe('closed');
    expect(trades[1].quantityOpened).toBe(3);
  });
});
