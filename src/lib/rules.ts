// ── Rules engine — pure TS, no DB, no side-effects ─────────────────────────

import {
  TRADING_TIMEZONE,
  OUTLAY_CAP,
  REENTRY_PAUSE_MIN,
  CIRCUIT_BREAKER,
  CHOP_TRADE_CAP,
  SESSION_OPEN_HOUR,
} from '@/lib/config';
// Detects mechanically-checkable violations from trade execution data + session
// sentiment. Computed on demand; never persisted.


// ── Public types ─────────────────────────────────────────────────────────────

export interface RuleTrade {
  firstExecId: string;
  underlying: string;
  expiry: string | null;       // YYYY-MM-DD
  openedAt: Date;
  closedAt: Date;
  quantityOpened: number;
  avgEntryPrice: number;       // per-contract, no multiplier
  realizedPnl: number;
}

export interface SessionInput {
  sessionDate: string;          // YYYY-MM-DD (TRADING_TIMEZONE)
  sentiment: string | null;     // 'Bullish' | 'Bearish' | 'Uncertain' | null (unjournaled)
  trades: RuleTrade[];          // closed trades, sorted by openedAt ASC
}

export interface RuleViolation {
  rule: number;
  title: string;
  scope: 'trade' | 'session';
  firstExecId?: string;         // trade-scoped only
  detail: string;               // human sentence with the numbers
}

export type RuleDetector =
  | 'oversized-outlay'
  | 'reentry-pause'
  | 'single-name-at-once'
  | 'zero-dte'
  | 'chop-trade-cap'
  | 'circuit-breaker'
  | 'opening-range-entry';

export interface RuleConfig {
  rule: number;
  title: string;
  description: string;
  enabled: boolean;
  detector: RuleDetector | null;
}

// ── RULES catalogue ──────────────────────────────────────────────────────────

/**
 * The rules that ship with a fresh install: ONE sample, deliberately.
 *
 * Your rulebook is personal — it encodes how you trade, what has burned you,
 * and what your account can absorb. Shipping someone else's would be worse
 * than shipping none. So this is a single worked example that shows the shape
 * and demonstrates a mechanical detector firing.
 *
 * These are seeded into the `trading_rules` table on first read, after which
 * the database is the source of truth: add, edit, disable, and delete rules at
 * /rules in the app. Editing this array afterwards only affects rule numbers
 * that are not already in the table.
 *
 * To add a rule the engine checks AUTOMATICALLY, copy an entry from
 * DETECTOR_TEMPLATES below into this array. Rules you create in the UI are
 * reflective (detector: null) — they show up in your rulebook and in the AI
 * coaching prompt, but nothing fires on its own.
 */
export const DEFAULT_RULE_CONFIGS: RuleConfig[] = [
  {
    rule: 1,
    title: 'Maximum position outlay',
    description: `Position cost (contracts × avg-entry × 100) must not exceed $${OUTLAY_CAP}. Large outlay amplifies risk on options that can go to zero. Set RULE_OUTLAY_CAP in .env to match your account.`,
    enabled: true,
    detector: 'oversized-outlay',
  },
];

/**
 * The rest of the detection engine, as ready-to-use templates.
 *
 * These are NOT active — nothing here is seeded or shown until you copy an
 * entry into DEFAULT_RULE_CONFIGS above (renumbering as you like) and restart.
 * They exist because the detectors are already implemented in
 * detectViolations() below; this is the menu of what the engine can check for
 * you, not a rulebook anyone is suggesting you adopt.
 *
 * Thresholds come from .env — see src/lib/config.ts.
 */
export const DETECTOR_TEMPLATES: RuleConfig[] = [
  {
    rule: 2,
    title: 'Loss pause before re-entry',
    description: `After a losing exit on a name, wait at least ${REENTRY_PAUSE_MIN} minutes before re-entering that same underlying. Prevents chasing a losing thesis.`,
    enabled: true,
    detector: 'reentry-pause',
  },
  {
    rule: 3,
    title: 'One trade at a time',
    description: 'Only one underlying position at a time. Opening a second ticker while the first is still open fragments attention and doubles risk.',
    enabled: true,
    detector: 'single-name-at-once',
  },
  {
    rule: 4,
    title: 'No zero-DTE contracts',
    description: 'Use 1 DTE minimum. Zero-DTE gamma sensitivity causes option price collapse during normal consolidation, invalidating management even when the underlying thesis remains intact.',
    enabled: true,
    detector: 'zero-dte',
  },
  {
    rule: 5,
    title: 'Chop-day trade cap',
    description: `On an Uncertain tape, cap trades at ${CHOP_TRADE_CAP}. Chop generates loss-of-edge fill sequences.`,
    enabled: true,
    detector: 'chop-trade-cap',
  },
  {
    rule: 6,
    title: 'Daily loss circuit breaker',
    description: `Once the running day P&L reaches $${CIRCUIT_BREAKER} or worse, stop opening new trades. Prevents spiralling drawdowns. Set RULE_CIRCUIT_BREAKER in .env to match your account.`,
    enabled: true,
    detector: 'circuit-breaker',
  },
  {
    rule: 7,
    title: 'Opening-range caution',
    description: `The first 30–45 minutes after the open (before ${SESSION_OPEN_HOUR}:00 local) is chop. Entries before then are flagged. Set RULE_SESSION_OPEN_HOUR for your timezone and style.`,
    enabled: true,
    detector: 'opening-range-entry',
  },
];

/** Every detector the engine implements. */
export const ALL_DETECTORS: RuleDetector[] = [
  'oversized-outlay',
  'reentry-pause',
  'single-name-at-once',
  'zero-dte',
  'chop-trade-cap',
  'circuit-breaker',
  'opening-range-entry',
];

export const RULES: Record<number, { title: string; description: string }> =
  Object.fromEntries(
    DEFAULT_RULE_CONFIGS.map(({ rule, title, description }) => [
      rule,
      { title, description },
    ]),
  );

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return the hour (0-23) of a UTC Date in TRADING_TIMEZONE. */
const TZ_HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: 'numeric',
  hour12: false,
});

function ptHour(d: Date): number {
  // hour12:false gives '0'–'23'; Intl may return '24' for midnight in some
  // engines, but in practice openedAt is never midnight.
  return parseInt(TZ_HOUR_FMT.format(d), 10);
}

/** Format a Date to HH:MM in TRADING_TIMEZONE (for detail strings). */
const TZ_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function ptTime(d: Date): string {
  return TZ_TIME_FMT.format(d);
}

/** Round a dollar amount to 2 dp for display. */
function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 100) / 100;
  return (n < 0 ? '-' : '') + '$' + rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── Detection ────────────────────────────────────────────────────────────────

export function detectViolations(
  input: SessionInput,
  rules: RuleConfig[] = DEFAULT_RULE_CONFIGS,
): RuleViolation[] {
  const { sessionDate, sentiment, trades } = input;
  // Detectors are looked up by DETECTOR, not by rule number: rule numbers are
  // user-editable (rules can be added, renumbered, or deleted at /rules), so
  // binding a detector to a hardcoded number would silently stop detecting the
  // moment someone reorganised their rulebook. The reported rule number comes
  // from whichever rule actually carries the detector.
  const byDetector = new Map<RuleDetector, RuleConfig>();
  for (const rule of rules) {
    if (!rule.enabled || rule.detector === null) continue;
    if (!byDetector.has(rule.detector)) byDetector.set(rule.detector, rule);
  }
  const activeRule = (detector: RuleDetector): RuleConfig | null =>
    byDetector.get(detector) ?? null;

  // Work with trades sorted by openedAt (caller should provide this, but sort
  // defensively to guarantee correct logic).
  const sorted = [...trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

  const violations: RuleViolation[] = [];

  // ── Per-trade rules ────────────────────────────────────────────────────────
  for (let i = 0; i < sorted.length; i++) {
    const trade = sorted[i];

    // R1 — Oversized outlay
    const r1 = activeRule('oversized-outlay');
    const outlay = trade.quantityOpened * trade.avgEntryPrice * 100;
    if (r1 && outlay > OUTLAY_CAP) {
      const outlayRounded = Math.round(outlay);
      violations.push({
        rule: r1.rule,
        title: r1.title,
        scope: 'trade',
        firstExecId: trade.firstExecId,
        detail: `Position outlay ${fmtDollar(outlayRounded)} exceeds the ${fmtDollar(OUTLAY_CAP)} cap (${trade.quantityOpened} contracts × $${trade.avgEntryPrice} × 100).`,
      });
    }

    // R4 — Re-entry without pause
    // Find the most recent prior trade on the same underlying that was a loss
    const r4 = activeRule('reentry-pause');
    if (r4) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = sorted[j];
        if (prev.underlying !== trade.underlying) continue;
        // Found the most recent prior trade on same underlying
        if (prev.realizedPnl <= 0) {
          const gapMs = trade.openedAt.getTime() - prev.closedAt.getTime();
          const gapMin = gapMs / 60_000;
          if (gapMin < REENTRY_PAUSE_MIN) {
            const gapDisplay = `${Math.floor(gapMin)}m`;
            violations.push({
              rule: r4.rule,
              title: r4.title,
              scope: 'trade',
              firstExecId: trade.firstExecId,
              detail: `Re-entered ${trade.underlying} ${gapDisplay} after a losing exit (P&L ${fmtDollar(prev.realizedPnl)}); the required pause is ${REENTRY_PAUSE_MIN}m.`,
            });
          }
        }
        // Only check the most recent prior trade on same underlying
        break;
      }
    }

    // R6 — Multiple names at once
    // Check if any earlier trade (different underlying) is still open when this one opens
    const r6 = activeRule('single-name-at-once');
    if (r6) {
      for (let j = 0; j < i; j++) {
        const prev = sorted[j];
        if (prev.underlying === trade.underlying) continue;
        // prev is open while trade opens: trade.openedAt < prev.closedAt
        if (trade.openedAt.getTime() < prev.closedAt.getTime()) {
          violations.push({
            rule: r6.rule,
            title: r6.title,
            scope: 'trade',
            firstExecId: trade.firstExecId,
            detail: `Opened ${trade.underlying} at ${ptTime(trade.openedAt)} while ${prev.underlying} was still open (closed ${ptTime(prev.closedAt)}).`,
          });
          break; // one R6 per trade is enough — report first conflict found
        }
      }
    }

    // R13 — Zero-DTE contract
    const r13 = activeRule('zero-dte');
    if (r13 && trade.expiry !== null && trade.expiry === sessionDate) {
      violations.push({
        rule: r13.rule,
        title: r13.title,
        scope: 'trade',
        firstExecId: trade.firstExecId,
        detail: `Contract expires on ${trade.expiry} — same as the session date (zero DTE).`,
      });
    }

    // R21 — Opening-range entry
    const r21 = activeRule('opening-range-entry');
    const hour = ptHour(trade.openedAt);
    if (r21 && hour < SESSION_OPEN_HOUR) {
      violations.push({
        rule: r21.rule,
        title: r21.title,
        scope: 'trade',
        firstExecId: trade.firstExecId,
        detail: `Entered ${trade.underlying} at ${ptTime(trade.openedAt)}, before the ${SESSION_OPEN_HOUR}:00 cutoff.`,
      });
    }
  }

  // ── Session-scoped rules ───────────────────────────────────────────────────

  // R15 — Overtrading a chop day
  const r15 = activeRule('chop-trade-cap');
  if (r15 && sentiment === 'Uncertain' && sorted.length > CHOP_TRADE_CAP) {
    violations.push({
      rule: r15.rule,
      title: r15.title,
      scope: 'session',
      detail: `${sorted.length} trades on an Uncertain tape exceeds the ${CHOP_TRADE_CAP}-trade cap.`,
    });
  }

  // R18 — Trading through the circuit breaker
  // Walk trades in openedAt order; track cumulative PnL at each close.
  // Once cumPnl ≤ CIRCUIT_BREAKER, check if any later trade opens.
  const r18 = activeRule('circuit-breaker');
  if (r18) {
    let cumPnl = 0;
    let breachCumPnl: number | null = null;
    let breachIndex = -1;

    for (let i = 0; i < sorted.length; i++) {
      cumPnl += sorted[i].realizedPnl;
      if (breachCumPnl === null && cumPnl <= CIRCUIT_BREAKER) {
        breachCumPnl = cumPnl;
        breachIndex = i;
      }
    }

    // If breached and there are trades that opened AFTER the breaching trade closed
    if (breachCumPnl !== null && breachIndex < sorted.length - 1) {
      // Confirm at least one later trade opened after the breach trade's close
      const breachClosedAt = sorted[breachIndex].closedAt.getTime();
      const laterOpened = sorted.slice(breachIndex + 1).some(
        (t) => t.openedAt.getTime() >= breachClosedAt,
      );
      if (laterOpened) {
        violations.push({
          rule: r18.rule,
          title: r18.title,
          scope: 'session',
          detail: `Continued opening trades after the day hit ${fmtDollar(Math.round(breachCumPnl * 100) / 100)} (circuit breaker is ${fmtDollar(CIRCUIT_BREAKER)}).`,
        });
      }
    }
  }

  // Sort violations by rule number for deterministic output
  violations.sort((a, b) => a.rule - b.rule);

  return violations;
}
