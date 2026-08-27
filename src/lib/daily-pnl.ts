import type { Trade } from './types';
import { round2 } from './trade-builder';
import { TRADING_TIMEZONE } from '@/lib/config';

const PT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TRADING_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

/** PT calendar date (YYYY-MM-DD) for a UTC instant — the trading "session" day. */
export function sessionDate(d: Date): string {
  return PT.format(d);
}

export function dailyPnl(trades: Trade[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const t of trades) {
    if (t.status !== 'closed' || t.closedAt === null || t.realizedPnl === null) continue;
    const day = sessionDate(t.closedAt);
    days.set(day, round2((days.get(day) ?? 0) + t.realizedPnl));
  }
  return days;
}
