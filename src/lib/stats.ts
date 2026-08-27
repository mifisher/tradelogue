import { round2 } from './trade-builder';
import { TRADING_TIMEZONE } from '@/lib/config';

export interface StatTrade {
  underlying: string;
  direction: 'long' | 'short';
  openedAt: Date;
  closedAt: Date;
  sessionDate: string;
  quantityOpened: number;
  realizedPnl: number;
}

export interface Stats {
  tradeCount: number; winCount: number; lossCount: number;
  winRate: number; totalPnl: number;
  avgWin: number | null; avgLoss: number | null;
  profitFactor: number | null; expectancy: number;
  largestWin: number | null; largestLoss: number | null;
}

export interface DayPnl { day: string; pnl: number; }

export function computeStats(trades: StatTrade[]): Stats {
  const wins = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = losses.reduce((s, t) => s + t.realizedPnl, 0);
  const total = grossWin + grossLoss;
  return {
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    totalPnl: round2(total),
    avgWin: wins.length ? round2(grossWin / wins.length) : null,
    avgLoss: losses.length ? round2(grossLoss / losses.length) : null,
    profitFactor: grossLoss < 0 ? round2(grossWin / -grossLoss) : null,
    expectancy: trades.length ? round2(total / trades.length) : 0,
    largestWin: wins.length ? round2(Math.max(...wins.map((t) => t.realizedPnl))) : null,
    largestLoss: losses.length ? round2(Math.min(...losses.map((t) => t.realizedPnl))) : null,
  };
}

export function equityCurve(days: DayPnl[]): Array<DayPnl & { cumPnl: number }> {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  let cum = 0;
  return sorted.map((d) => ({ ...d, cumPnl: round2((cum = round2(cum + d.pnl))) }));
}

export function dayStreaks(days: DayPnl[]) {
  let current = 0, bestGreenStreak = 0, worstRedStreak = 0;
  for (const d of days) {
    const green = d.pnl > 0;
    current = green ? (current > 0 ? current + 1 : 1) : (current < 0 ? current - 1 : -1);
    if (current > bestGreenStreak) bestGreenStreak = current;
    if (current < -worstRedStreak) worstRedStreak = -current;
  }
  return { current, bestGreenStreak, worstRedStreak };
}

export function groupStats(trades: StatTrade[], key: (t: StatTrade) => string): Map<string, Stats> {
  const groups = new Map<string, StatTrade[]>();
  for (const t of trades) {
    const k = key(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  return new Map([...groups].map(([k, v]) => [k, computeStats(v)]));
}

export const byTicker = (t: StatTrade) => t.underlying;

const TZ_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: TRADING_TIMEZONE, weekday: 'short' });
export const byDayOfWeek = (t: StatTrade) => TZ_WEEKDAY.format(t.openedAt);

const PT_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: TRADING_TIMEZONE, hour: 'numeric', hour12: true });
export const byEntryHour = (t: StatTrade) => PT_HOUR.format(t.openedAt).replace(/ /g, ' ');

export function byHoldTime(t: StatTrade): string {
  const mins = (t.closedAt.getTime() - t.openedAt.getTime()) / 60_000;
  if (mins < 5) return '<5m';
  if (mins < 15) return '5–15m';
  if (mins < 30) return '15–30m';
  if (mins < 60) return '30–60m';
  return '1h+';
}
