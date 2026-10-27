// ── Rules engine — pure TS, no DB, no side-effects ─────────────────────────

import {
  TRADING_TIMEZONE,
  OUTLAY_CAP,
  REENTRY_PAUSE_MIN,
  CIRCUIT_BREAKER,
  CHOP_TRADE_CAP,
  OPENING_RANGE_MIN,
  timezoneLabel,
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

/** Every detector the engine implements. */
export const ALL_DETECTORS = [
  'oversized-outlay',
  'reentry-pause',
  'single-name-at-once',
  'zero-dte',
  'chop-trade-cap',
  'circuit-breaker',
  'opening-range-entry',
  'max-trades-per-session',
] as const;

export type RuleDetector = typeof ALL_DETECTORS[number];

/** Default threshold per detector (from .env — see src/lib/config.ts); null = takes no number. */
export const DEFAULT_THRESHOLDS: Record<RuleDetector, number | null> = {
  'oversized-outlay': OUTLAY_CAP,             // max option position cost, dollars
  'reentry-pause': REENTRY_PAUSE_MIN,         // minutes after a losing exit on the same name
  'single-name-at-once': null,
  'zero-dte': null,
  'chop-trade-cap': CHOP_TRADE_CAP,           // max trades on an Uncertain tape
  'circuit-breaker': CIRCUIT_BREAKER,         // stop opening once day P&L ≤ this
  'opening-range-entry': OPENING_RANGE_MIN,   // minutes after the 09:30 ET open
  'max-trades-per-session': 3,                // max closed trades in a session
};

export interface RuleConfig {
  rule: number;
  title: string;
  description: string;
  enabled: boolean;
  detector: RuleDetector | null;
  /** Detector threshold; null/undefined = DEFAULT_THRESHOLDS[detector]. */
  threshold?: number | null;
}

export type DetectorFinding = Pick<RuleViolation, 'scope' | 'firstExecId' | 'detail'>;

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
    description: `Position cost (contracts × avg-entry × 100) must not exceed $${OUTLAY_CAP} on options (stock is exempt). Large outlay amplifies risk on options that can go to zero. Set RULE_OUTLAY_CAP in .env to match your account.`,
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
    description: `The first 30–45 minutes after the 09:30 ET open is chop. Entries in the first ${OPENING_RANGE_MIN} minutes are flagged. Set RULE_OPENING_RANGE_MIN to match your style.`,
    enabled: true,
    detector: 'opening-range-entry',
  },
  {
    rule: 8,
    title: 'Maximum trades per session',
    description: `Stop after ${DEFAULT_THRESHOLDS['max-trades-per-session']} closed trades in a session, whatever the tape. Overtrading turns a plan into a slot machine.`,
    enabled: true,
    detector: 'max-trades-per-session',
  },
];

export const RULES: Record<number, { title: string; description: string }> =
  Object.fromEntries(
    DEFAULT_RULE_CONFIGS.map(({ rule, title, description }) => [
      rule,
      { title, description },
    ]),
  );

// ── Helpers ──────────────────────────────────────────────────────────────────

/** HH:MM in New York — the exchange's clock, independent of where the user is. */
const ET_HM_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

const MARKET_OPEN_MIN = 9 * 60 + 30;

/** Minutes between the 9:30 ET regular-session open and `d` (negative pre-market). */
export function minutesAfterOpen(d: Date): number {
  const parts = ET_HM_FMT.formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m - MARKET_OPEN_MIN;
}

/** HH:MM in TRADING_TIMEZONE, for detail strings (pair with timezoneLabel). */
const LOCAL_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function localTime(d: Date): string {
  return `${LOCAL_TIME_FMT.format(d)} ${timezoneLabel(d)}`;
}

/** Round a dollar amount to 2 dp for display. */
function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 100) / 100;
  return (n < 0 ? '-' : '') + '$' + rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── Detection ────────────────────────────────────────────────────────────────

/** Run one detector over a session. Shared by rules and goals so they never disagree. */
export function runDetector(
  detector: RuleDetector,
  threshold: number | null,
  input: SessionInput,
): DetectorFinding[] {
  const limit = threshold ?? DEFAULT_THRESHOLDS[detector];
  const { sessionDate, sentiment } = input;
  const sorted = [...input.trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const out: DetectorFinding[] = [];
  const perTrade = (firstExecId: string, detail: string) => out.push({ scope: 'trade', firstExecId, detail });

  switch (detector) {
    case 'oversized-outlay':
      for (const t of sorted) {
        // Options only: the cap guards premium that can go to zero. Stock has
        // no expiry (the same signal zero-dte uses).
        if (t.expiry === null) continue;
        const outlay = t.quantityOpened * t.avgEntryPrice * 100;
        if (outlay > limit!) {
          perTrade(t.firstExecId, `Position outlay ${fmtDollar(Math.round(outlay))} exceeds the ${fmtDollar(limit!)} cap (${t.quantityOpened} contracts × $${t.avgEntryPrice} × 100).`);
        }
      }
      break;

    case 'reentry-pause':
      for (let i = 0; i < sorted.length; i++) {
        const t = sorted[i];
        // Only the most recent prior trade on the same underlying matters.
        const prev = sorted.slice(0, i).reverse().find((p) => p.underlying === t.underlying);
        if (!prev || prev.realizedPnl > 0) continue;
        const gapMin = (t.openedAt.getTime() - prev.closedAt.getTime()) / 60_000;
        if (gapMin < limit!) {
          perTrade(t.firstExecId, `Re-entered ${t.underlying} ${Math.floor(gapMin)}m after a losing exit (P&L ${fmtDollar(prev.realizedPnl)}); the required pause is ${limit}m.`);
        }
      }
      break;

    case 'single-name-at-once':
      for (let i = 0; i < sorted.length; i++) {
        const t = sorted[i];
        const conflict = sorted.slice(0, i).find(
          (p) => p.underlying !== t.underlying && t.openedAt.getTime() < p.closedAt.getTime(),
        );
        if (conflict) {
          perTrade(t.firstExecId, `Opened ${t.underlying} at ${localTime(t.openedAt)} while ${conflict.underlying} was still open (closed ${localTime(conflict.closedAt)}).`);
        }
      }
      break;

    case 'zero-dte':
      for (const t of sorted) {
        if (t.expiry !== null && t.expiry === sessionDate) {
          perTrade(t.firstExecId, `Contract expires on ${t.expiry} — same as the session date (zero DTE).`);
        }
      }
      break;

    case 'opening-range-entry':
      for (const t of sorted) {
        const mins = minutesAfterOpen(t.openedAt);
        if (mins < limit!) {
          const when = mins < 0 ? 'before the open' : `${mins} min after the open`;
          perTrade(t.firstExecId, `Entered ${t.underlying} at ${localTime(t.openedAt)}, ${when} (the first ${limit} min are off-limits).`);
        }
      }
      break;

    case 'chop-trade-cap':
      if (sentiment === 'Uncertain' && sorted.length > limit!) {
        out.push({ scope: 'session', detail: `${sorted.length} trades on an Uncertain tape exceeds the ${limit}-trade cap.` });
      }
      break;

    case 'max-trades-per-session':
      if (sorted.length > limit!) {
        out.push({ scope: 'session', detail: `${sorted.length} trades, limit ${limit}.` });
      }
      break;

    case 'circuit-breaker': {
      // Walk trades in openedAt order; once cumulative PnL ≤ limit, any later
      // trade opening after the breaching trade closed is a violation.
      let cumPnl = 0;
      let breachIndex = -1;
      let breachPnl = 0;
      for (let i = 0; i < sorted.length; i++) {
        cumPnl += sorted[i].realizedPnl;
        if (breachIndex === -1 && cumPnl <= limit!) {
          breachIndex = i;
          breachPnl = cumPnl;
        }
      }
      if (breachIndex !== -1) {
        const breachClosedAt = sorted[breachIndex].closedAt.getTime();
        if (sorted.slice(breachIndex + 1).some((t) => t.openedAt.getTime() >= breachClosedAt)) {
          out.push({ scope: 'session', detail: `Continued opening trades after the day hit ${fmtDollar(Math.round(breachPnl * 100) / 100)} (circuit breaker is ${fmtDollar(limit!)}).` });
        }
      }
      break;
    }
  }
  return out;
}

export function detectViolations(
  input: SessionInput,
  rules: RuleConfig[] = DEFAULT_RULE_CONFIGS,
): RuleViolation[] {
  // Detectors are looked up by DETECTOR, not by rule number: rule numbers are
  // user-editable (rules can be added, renumbered, or deleted at /rules), so
  // binding a detector to a hardcoded number would silently stop detecting the
  // moment someone reorganised their rulebook. The first enabled rule carrying
  // a detector reports it, with that rule's own threshold.
  const byDetector = new Map<RuleDetector, RuleConfig>();
  for (const rule of rules) {
    if (!rule.enabled || rule.detector === null) continue;
    if (!byDetector.has(rule.detector)) byDetector.set(rule.detector, rule);
  }

  const violations: RuleViolation[] = [];
  for (const [detector, rule] of byDetector) {
    for (const f of runDetector(detector, rule.threshold ?? null, input)) {
      violations.push({ rule: rule.rule, title: rule.title, ...f });
    }
  }
  // Stable sort: within a rule, findings stay in trade order.
  return violations.sort((a, b) => a.rule - b.rule);
}
