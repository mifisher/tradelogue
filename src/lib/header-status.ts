import { sessionDate } from '@/lib/daily-pnl';
import { TRADING_TIMEZONE, timezoneLabel } from '@/lib/config';

const TZ = TRADING_TIMEZONE;

/** Just the columns the header needs — never the brief payload, since this
 * runs on every page render. */
export interface BriefFreshness {
  briefDate: string;
  generatedAt: Date;
  status: string;
}

export interface HeaderStatus {
  /** "Thu, Jul 30 · ET" — the trading session the page's data is filtered on. */
  dateLabel: string;
  /** "Updated 8:03 AM", "Brief from Jul 29", or "No brief yet". */
  updatedLabel: string;
  /** stale is the state worth noticing: the brief predates today's session, so
   * anything not date-filtered is yesterday's tape. */
  state: 'fresh' | 'stale' | 'none';
}

function ptDate(date: string, opts: Intl.DateTimeFormatOptions): string {
  // Noon UTC keeps a YYYY-MM-DD from sliding a day under any zone offset.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

/** What the header says about "which day is this, and is the data today's".
 *
 * Deliberately labelled in TRADING_TIMEZONE rather than the viewer's zone: the
 * journal buckets everything by that session, so a header showing a different
 * day than the one the cards filter on would create exactly the doubt it
 * exists to remove. */
export function headerStatus(now: Date, freshness: BriefFreshness | null): HeaderStatus {
  const today = sessionDate(now);
  const dateLabel = `${ptDate(today, { weekday: 'short', month: 'short', day: 'numeric' })} · ${timezoneLabel(now)}`;

  if (!freshness) return { dateLabel, updatedLabel: 'No brief yet', state: 'none' };

  if (freshness.briefDate !== today) {
    return {
      dateLabel,
      updatedLabel: `Brief from ${ptDate(freshness.briefDate, { month: 'short', day: 'numeric' })}`,
      state: 'stale',
    };
  }

  const time = freshness.generatedAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
  return { dateLabel, updatedLabel: `Updated ${time}`, state: 'fresh' };
}
