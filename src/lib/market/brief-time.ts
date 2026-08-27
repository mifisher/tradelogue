import type { StoredEconEvent } from './brief-schema';

const WEEKEND_DAYS = new Set([0, 6]); // Sunday, Saturday

/** Step `count` weekdays forward (positive) or back (negative), skipping
 * weekends. Market holidays are not modelled — those days simply come back
 * empty, which reads the same on the calendar. */
function shiftWeekdays(date: string, count: number): string {
  const d = new Date(date + 'T12:00:00Z');
  const step = count < 0 ? -1 : 1;
  let remaining = Math.abs(count);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (!WEEKEND_DAYS.has(d.getUTCDay())) remaining -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export const EARNINGS_WINDOW_DAYS = 5;

/** The five sessions the earnings calendar covers: the previous trading day,
 * today, and the next three. Today is deliberately second so the most recent
 * results stay visible next to what is still coming. Today is always included
 * even if it falls on a weekend — that card just renders empty. */
export function earningsWindow(todayPt: string): string[] {
  return [
    shiftWeekdays(todayPt, -1),
    todayPt,
    shiftWeekdays(todayPt, 1),
    shiftWeekdays(todayPt, 2),
    shiftWeekdays(todayPt, 3),
  ];
}

export interface EconDay {
  date: string;
  events: StoredEconEvent[];
}

/** Bucket the week's releases into day groups for the calendar table, days
 * ascending and chronological within a day (date-only "all day" entries last).
 * The whole week is kept, released days included: a Thursday session is traded
 * against Wednesday's FOMC, and dropping the past days is what made the old
 * card look like it had put today's events on the wrong date. */
export function groupEconByDay(events: StoredEconEvent[]): EconDay[] {
  const byDate = new Map<string, StoredEconEvent[]>();
  for (const event of events) {
    const bucket = byDate.get(event.date);
    if (bucket) bucket.push(event);
    else byDate.set(event.date, [event]);
  }

  return [...byDate.keys()]
    .sort()
    .map((date) => ({
      date,
      events: [...byDate.get(date)!].sort((a, b) => {
        if (a.timeUtc && b.timeUtc) return a.timeUtc < b.timeUtc ? -1 : a.timeUtc > b.timeUtc ? 1 : 0;
        if (a.timeUtc) return -1;
        if (b.timeUtc) return 1;
        return 0;
      }),
    }));
}
