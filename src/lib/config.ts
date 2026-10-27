// ── User-tunable configuration ──────────────────────────────────────────────
// Everything here is a personal-preference knob, not a fact about the market.
// Defaults are deliberately generic starting points — set the matching env vars
// in .env to match how you actually trade. See "Making it yours" in the README.

/**
 * Timezone all session dates, "day" boundaries, and rule times are evaluated
 * in. A trade at 06:45 belongs to whichever session date this timezone says.
 * Blank = this machine's system zone (the server runs locally, so it and the
 * browser agree).
 *
 * NEXT_PUBLIC_ so client components format timestamps the same way the server
 * grouped them — otherwise a trade can render under the wrong day.
 */
export const TRADING_TIMEZONE =
  process.env.NEXT_PUBLIC_TRADING_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

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
 * Opening-range rule — entries in the first N minutes after the 09:30 ET
 * regular-session open are flagged as trading the opening chop. Measured on
 * the exchange's clock, so it means the same thing in any TRADING_TIMEZONE
 * and across DST.
 */
export const OPENING_RANGE_MIN = num(process.env.RULE_OPENING_RANGE_MIN, 30);

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
