// ── Goals — pure TS, no DB ──────────────────────────────────────────────────
// A goal is a time-boxed experiment. Progress is derived on read by running
// the rules-engine detectors over sessions traded after the goal started.

import { z } from 'zod';
import { fromZonedTime } from 'date-fns-tz';
import { runDetector, type RuleDetector, type RuleTrade } from './rules';
import { round2 } from './trade-builder';
import { TRADING_TIMEZONE } from '@/lib/config';

export const GOAL_CHECK_TYPES = [
  'max-trades-per-session',
  'max-outlay-per-trade',
  'daily-loss-stop',
  'reentry-pause',
  'no-entries-before',
  'no-zero-dte',
  'self-report',
] as const;
export type GoalCheckType = typeof GOAL_CHECK_TYPES[number];
export type GoalStatus = 'active' | 'completed' | 'promoted' | 'dropped';

interface CheckSpec {
  detector: RuleDetector | null;
  needsThreshold: boolean;
  valid?: (n: number) => boolean;
  /** One line for the AI prompt and the start dialog's help text. */
  prompt: string;
}

export const GOAL_CHECKS: Record<GoalCheckType, CheckSpec> = {
  'max-trades-per-session': { detector: 'max-trades-per-session', needsThreshold: true, valid: (n) => Number.isInteger(n) && n >= 1, prompt: 'threshold = max closed trades in one session (integer ≥ 1)' },
  'max-outlay-per-trade': { detector: 'oversized-outlay', needsThreshold: true, valid: (n) => n > 0, prompt: 'threshold = max option position cost per trade in dollars (contracts × price × 100); stock trades are not checked' },
  'daily-loss-stop': { detector: 'circuit-breaker', needsThreshold: true, valid: (n) => n < 0, prompt: 'threshold = day P&L in negative dollars at which no new trades may open, e.g. -300' },
  'reentry-pause': { detector: 'reentry-pause', needsThreshold: true, valid: (n) => n > 0, prompt: 'threshold = minutes to wait before re-entering the same ticker after a losing exit' },
  'no-entries-before': { detector: 'opening-range-entry', needsThreshold: true, valid: (n) => Number.isInteger(n) && n > 0 && n < 390, prompt: 'threshold = minutes after the 9:30 ET open during which no entries are allowed, e.g. 30' },
  'no-zero-dte': { detector: 'zero-dte', needsThreshold: false, prompt: 'threshold = null; no contracts expiring the same day' },
  'self-report': { detector: null, needsThreshold: false, prompt: 'threshold = null; use when the experiment cannot be checked from trade data' },
};

export const GoalCheckSchema = z.object({
  type: z.enum(GOAL_CHECK_TYPES),
  threshold: z.number().nullable(),
});
export type GoalCheck = z.infer<typeof GoalCheckSchema>;
export const SELF_REPORT: GoalCheck = { type: 'self-report', threshold: null };

export function isValidCheck(c: GoalCheck): boolean {
  const spec = GOAL_CHECKS[c.type];
  if (!spec.needsThreshold) return c.threshold === null;
  return c.threshold !== null && Number.isFinite(c.threshold) && spec.valid!(c.threshold);
}

/** The experiment's check, or self-report when missing or unusable (older analyses, bad model output). */
export function normalizeCheck(c: unknown): GoalCheck {
  const parsed = GoalCheckSchema.safeParse(c);
  if (!parsed.success) return SELF_REPORT;
  const check = GOAL_CHECKS[parsed.data.type].needsThreshold
    ? parsed.data
    : { ...parsed.data, threshold: null };
  return isValidCheck(check) ? check : SELF_REPORT;
}

const TODAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TRADING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    .format(d)
    .replace(/ /g, ' ');

/** "until 10:00 AM EDT · 7:00 AM PDT": the cutoff on `day` in market time and the user's zone. */
function openPlusLabel(minutes: number, day: string): string {
  const at = new Date(fromZonedTime(`${day}T09:30:00`, 'America/New_York').getTime() + minutes * 60_000);
  const et = clock(at, 'America/New_York');
  const local = clock(at, TRADING_TIMEZONE);
  return et === local ? `until ${et}` : `until ${et} · ${local}`;
}

const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US')}`;

export function describeCheck(c: GoalCheck, day: string = TODAY_FMT.format(new Date())): string {
  const t = c.threshold!;
  switch (c.type) {
    case 'max-trades-per-session': return `≤ ${t} trades/session`;
    case 'max-outlay-per-trade': return `≤ ${usd(t)} outlay per trade`;
    case 'daily-loss-stop': return `Stop at −${usd(t)} on the day`;
    case 'reentry-pause': return `${t} min pause after a losing exit`;
    case 'no-entries-before': return `No entries in the first ${t} min (${openPlusLabel(t, day)})`;
    case 'no-zero-dte': return 'No 0DTE contracts';
    case 'self-report': return 'Self-reported each session';
  }
}

const StartGoalInputSchema = z.object({
  title: z.string().trim().min(1),
  hypothesis: z.string().trim().min(1),
  protocol: z.string().trim().min(1),
  successMetric: z.string().trim().min(1),
  check: GoalCheckSchema,
  targetSessions: z.number().int().min(1).max(50),
});
export type StartGoalInput = z.infer<typeof StartGoalInputSchema>;

export function parseStartGoalInput(input: unknown): StartGoalInput {
  const parsed = StartGoalInputSchema.safeParse(input);
  if (!parsed.success) throw new Error('Fill in every field; sessions must be 1–50.');
  if (!isValidCheck(parsed.data.check)) {
    throw new Error(`That threshold doesn't fit this check: ${GOAL_CHECKS[parsed.data.check.type].prompt}.`);
  }
  return parsed.data;
}

/** Rule thresholds get the same bounds as the goal check that uses that detector. */
export function isValidDetectorThreshold(detector: RuleDetector | null, threshold: number | null): boolean {
  if (threshold === null) return true; // null = the detector's default
  const spec = Object.values(GOAL_CHECKS).find((c) => c.detector !== null && c.detector === detector);
  return !!spec?.needsThreshold && Number.isFinite(threshold) && spec.valid!(threshold);
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface GoalSession {
  sessionDate: string;
  sentiment: string | null;
  journaled: boolean;
  trades: RuleTrade[];
}

export interface GoalSpec {
  checkType: GoalCheckType;
  threshold: number | null;
  targetSessions: number;
  /** The goal row's createdAt. Sessions whose first trade opened at/after this count. */
  startedAt: Date;
  /** Set once the goal leaves 'active'; sessions after this date don't count. */
  closedOn?: string | null;
}

export interface SessionResult { sessionDate: string; hit: boolean; reason: string | null }

export interface GoalEvaluation {
  results: SessionResult[];
  counted: number;
  hits: number;
  finished: boolean;
  /** Traded after the start but not scorable yet (no journal entry / no self-report answer). */
  awaitingJournal: string[];
}

const firstOpen = (s: GoalSession) => Math.min(...s.trades.map((t) => t.openedAt.getTime()));
const byDate = (a: GoalSession, b: GoalSession) => a.sessionDate.localeCompare(b.sessionDate);

export function evaluateGoal(
  goal: GoalSpec,
  sessions: GoalSession[],
  checkins: Map<string, boolean>,
): GoalEvaluation {
  const detector = GOAL_CHECKS[goal.checkType].detector;
  const after = sessions
    .filter((s) => s.trades.length > 0 && firstOpen(s) >= goal.startedAt.getTime())
    .filter((s) => !goal.closedOn || s.sessionDate <= goal.closedOn)
    .sort(byDate);

  const results: SessionResult[] = [];
  const awaitingJournal: string[] = [];
  for (const s of after) {
    if (results.length >= goal.targetSessions) break;
    if (detector === null) {
      const hit = checkins.get(s.sessionDate);
      if (!s.journaled || hit === undefined) { awaitingJournal.push(s.sessionDate); continue; }
      results.push({ sessionDate: s.sessionDate, hit, reason: hit ? null : 'Self-reported miss' });
      continue;
    }
    if (!s.journaled) { awaitingJournal.push(s.sessionDate); continue; }
    const findings = runDetector(detector, goal.threshold, s);
    results.push({
      sessionDate: s.sessionDate,
      hit: findings.length === 0,
      reason: findings.length === 0
        ? null
        : findings[0].detail + (findings.length > 1 ? ` (+${findings.length - 1} more)` : ''),
    });
  }

  const hits = results.filter((r) => r.hit).length;
  return { results, counted: results.length, hits, finished: results.length >= goal.targetSessions, awaitingJournal };
}

export function baselineSessions(
  goal: GoalSpec,
  sessions: GoalSession[],
): { sessions: GoalSession[]; short: boolean } {
  const before = sessions
    .filter((s) => s.journaled && s.trades.length > 0 && firstOpen(s) < goal.startedAt.getTime())
    .sort(byDate)
    .slice(-goal.targetSessions);
  return { sessions: before, short: before.length < goal.targetSessions };
}

export interface SessionMetrics {
  sessions: number;
  dayWinRate: number;
  avgPnl: number;
  expectancy: number;
  avgTrades: number;
}

// ponytail: computed inline rather than through stats.computeStats — that takes
// StatTrade (direction, sessionDate…), which RuleTrade doesn't carry, and these
// four numbers are a few lines each.
export function sessionMetrics(sessions: GoalSession[]): SessionMetrics {
  const n = sessions.length;
  const pnls = sessions.map((s) => s.trades.reduce((sum, t) => sum + t.realizedPnl, 0));
  const total = pnls.reduce((a, b) => a + b, 0);
  const tradeCount = sessions.reduce((sum, s) => sum + s.trades.length, 0);
  return {
    sessions: n,
    dayWinRate: n ? pnls.filter((p) => p > 0).length / n : 0,
    avgPnl: n ? round2(total / n) : 0,
    expectancy: tradeCount ? round2(total / tradeCount) : 0,
    avgTrades: n ? tradeCount / n : 0,
  };
}
