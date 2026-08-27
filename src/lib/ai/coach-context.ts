// ── Coach context builder — pure, deterministic, no side-effects ─────────────
// Takes structured session data and produces the plain-text context block
// that is sent as the user message to the AI coaching model.

import type { RuleViolation } from '@/lib/rules';
import { fmtHold, fmtMoney } from '@/lib/format';

// ── Input types ──────────────────────────────────────────────────────────────

export interface CoachTradeInput {
  timePT: string;         // HH:MM in PT
  ticker: string;
  description: string;    // contract description e.g. "QQQ 12JUN26 460.0 P"
  qty: number;
  entry: number;
  exit: number;
  holdMs: number;
  pnl: number;
  setupName: string | null;
  grade: string | null;
  thesis: string | null;
  executionNotes: string | null;
}

export interface CoachSessionInput {
  sessionDate: string;
  sentiment: string | null;
  mood: string | null;
  sleepScore: number | null;
  sleepMinutes: number | null;
  marketContext: string | null;
  recap: string | null;
  journalPnl: number | null;
}

export interface CoachContextInput {
  session: CoachSessionInput;
  trades: CoachTradeInput[];
  violations: RuleViolation[];
  /** The trader's live rulebook, so the coach grades against what they
   *  actually keep — not a static list baked in at build time. */
  rulebook: Array<{ rule: number; title: string; description: string }>;
  /** The trader's named setups, so the coach can refer to them by name rather
   *  than the bare "Setup 3" that appears on each trade. */
  setupNames: Array<{ number: number; name: string }>;
  recentDays: Array<{
    day: string;
    pnl: number;
    tradeCount: number;
    violationCount: number;
  }>;
  allTime: {
    totalPnl: number;
    winRateDays: number;
    profitFactor: number | null;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function notJournaled(v: string | number | null | undefined): string {
  if (v == null) return '(not journaled)';
  return String(v);
}

function notAnnotated(v: string | null | undefined): string {
  if (v == null || v === '') return '(not annotated)';
  return v;
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a deterministic plain-text context block from structured session data.
 * The result is sent as the user message; the system prompt is byte-stable.
 */
export function buildCoachContext(input: CoachContextInput): string {
  const { session, trades, violations, rulebook, setupNames, recentDays, allTime } = input;

  const lines: string[] = [];

  // ── Session header ────────────────────────────────────────────────────────
  lines.push(`## Session: ${session.sessionDate}`);
  lines.push(`Tape sentiment: ${notJournaled(session.sentiment)}`);
  lines.push(`Mood: ${notJournaled(session.mood)}`);

  if (session.sleepScore != null || session.sleepMinutes != null) {
    const score = session.sleepScore != null ? `${session.sleepScore}/10` : '(not journaled)';
    const mins = session.sleepMinutes != null
      ? `${Math.floor(session.sleepMinutes / 60)}h ${session.sleepMinutes % 60}m`
      : '(not journaled)';
    lines.push(`Sleep: score ${score}, duration ${mins}`);
  } else {
    lines.push('Sleep: (not journaled)');
  }

  lines.push(`Market context: ${notJournaled(session.marketContext)}`);
  lines.push(`Recap: ${notJournaled(session.recap)}`);
  lines.push(
    `Journal P&L: ${session.journalPnl != null ? fmtMoney(session.journalPnl) : '(not journaled)'}`,
  );

  lines.push('');

  // ── Trades ────────────────────────────────────────────────────────────────
  lines.push('## Trades');
  if (trades.length === 0) {
    lines.push('(no closed trades)');
  } else {
    for (const t of trades) {
      lines.push(`- ${t.timePT} PT | ${t.ticker} | ${t.description}`);
      lines.push(
        `  qty: ${t.qty} | entry: ${t.entry} → exit: ${t.exit} | hold: ${fmtHold(t.holdMs)} | P&L: ${fmtMoney(t.pnl)}`,
      );
      lines.push(`  setup: ${notAnnotated(t.setupName)} | grade: ${notAnnotated(t.grade)}`);
      lines.push(`  thesis: ${notAnnotated(t.thesis)}`);
      lines.push(`  execution notes: ${notAnnotated(t.executionNotes)}`);
    }
  }

  lines.push('');

  // ── The trader's rulebook ─────────────────────────────────────────────────
  // Lives here rather than in the system prompt: rules are user-managed, so
  // baking them into a module-load constant would grade against a stale list.
  // Keeping the system prompt fully static also keeps its cache hit rate high.
  lines.push("## Trader's rulebook (numbered rules)");
  if (rulebook.length === 0) {
    lines.push('The trader has not written any rules yet. Do not cite rule numbers.');
  } else {
    for (const r of rulebook) {
      lines.push(`- Rule ${r.rule} — ${r.title}: ${r.description}`);
    }
  }
  lines.push('');

  // ── The trader's named setups ─────────────────────────────────────────────
  if (setupNames.length > 0) {
    lines.push("## Trader's named setups");
    for (const s of setupNames) lines.push(`- ${s.number} — ${s.name}`);
    lines.push('');
  }

  // ── Detected rule violations ──────────────────────────────────────────────
  lines.push('## Detected rule violations');
  if (violations.length === 0) {
    lines.push('None detected');
  } else {
    for (const v of violations) {
      const scopeNote = v.scope === 'trade' && v.firstExecId
        ? ` (trade-scoped, execId: ${v.firstExecId})`
        : ' (session-scoped)';
      lines.push(`- R${v.rule} — ${v.title}${scopeNote}: ${v.detail}`);
    }
  }

  lines.push('');

  // ── Recent sessions ───────────────────────────────────────────────────────
  lines.push('## Recent sessions');
  if (recentDays.length === 0) {
    lines.push('(no prior sessions)');
  } else {
    for (const d of recentDays) {
      lines.push(
        `- ${d.day}: ${fmtMoney(d.pnl)} | ${d.tradeCount} trade${d.tradeCount !== 1 ? 's' : ''} | ${d.violationCount} violation${d.violationCount !== 1 ? 's' : ''}`,
      );
    }
  }

  lines.push('');

  // ── All-time ──────────────────────────────────────────────────────────────
  lines.push('## All-time');
  lines.push(
    `Total P&L: ${fmtMoney(allTime.totalPnl)} | Win-rate (days): ${(allTime.winRateDays * 100).toFixed(1)}% | Profit factor: ${allTime.profitFactor != null ? allTime.profitFactor.toFixed(2) : 'N/A'}`,
  );

  return lines.join('\n');
}
