// ── User-tunable configuration ──────────────────────────────────────────────
// Everything here is a personal-preference knob, not a fact about the market.
// Defaults are deliberately generic starting points — set the matching env vars
// in .env to match how you actually trade. See "Making it yours" in the README.

/**
 * Timezone all session dates, "day" boundaries, and rule times are evaluated
 * in. A trade at 06:45 belongs to whichever session date this timezone says.
 *
 * NEXT_PUBLIC_ so client components format timestamps the same way the server
 * grouped them — otherwise a trade can render under the wrong day.
 */
export const TRADING_TIMEZONE =
  process.env.NEXT_PUBLIC_TRADING_TIMEZONE || 'America/New_York';

function num(envVar: string | undefined, fallback: number): number {
  if (envVar === undefined || envVar.trim() === '') return fallback;
  const parsed = Number(envVar);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** R1 — maximum position cost in dollars (contracts × entry × multiplier). */
export const OUTLAY_CAP = num(process.env.RULE_OUTLAY_CAP, 1000);

/** R4 — minutes to wait after a losing exit before re-entering the same name. */
export const REENTRY_PAUSE_MIN = num(process.env.RULE_REENTRY_PAUSE_MIN, 10);

/** R18 — stop opening new trades once running day P&L reaches this (negative). */
export const CIRCUIT_BREAKER = num(process.env.RULE_CIRCUIT_BREAKER, -500);

/** R15 — maximum trades to take on an Uncertain / choppy tape. */
export const CHOP_TRADE_CAP = num(process.env.RULE_CHOP_TRADE_CAP, 3);

/**
 * R21 — entries before this hour (24h clock, TRADING_TIMEZONE) are flagged as
 * trading the opening chop. Default 10 = the first 30 min after a 09:30 open.
 */
export const SESSION_OPEN_HOUR = num(process.env.RULE_SESSION_OPEN_HOUR, 10);

/**
 * Short label for TRADING_TIMEZONE ("ET", "PT", "GMT+1"…), for UI captions like
 * "Opened (ET)". Derived rather than hardcoded so the header does not claim a
 * zone the app is not actually bucketing sessions in.
 */
export function timezoneLabel(at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: TRADING_TIMEZONE,
    timeZoneName: 'short',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? TRADING_TIMEZONE;
}
