import { desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { goalCheckins, goals } from '@/db/schema';
import { closedTrades, journaledDates, sentimentByDate } from '@/lib/queries';
import { tradeToRuleTrade } from '@/lib/discipline';
import {
  baselineSessions, evaluateGoal, sessionMetrics,
  type GoalEvaluation, type GoalSession, type GoalSpec, type SessionMetrics,
} from '@/lib/goals';
import type { RuleTrade } from '@/lib/rules';

export type GoalRow = typeof goals.$inferSelect;

export async function getActiveGoal(): Promise<GoalRow | null> {
  const rows = await db.select().from(goals).where(eq(goals.status, 'active')).limit(1);
  return rows[0] ?? null;
}

export async function getGoal(id: number): Promise<GoalRow | null> {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function closedGoals(): Promise<GoalRow[]> {
  return db.select().from(goals).where(ne(goals.status, 'active')).orderBy(desc(goals.createdAt));
}

export async function checkinsFor(goalId: number): Promise<Map<string, boolean>> {
  const rows = await db.select().from(goalCheckins).where(eq(goalCheckins.goalId, goalId));
  return new Map(rows.map((r) => [r.sessionDate, r.hit]));
}

// ponytail: loads every closed trade once per render, like the dashboard does;
// add a date floor (earliest baseline start) if the trade table gets large.
async function goalSessions(): Promise<GoalSession[]> {
  const [rows, sentiments, journaled] = await Promise.all([closedTrades(), sentimentByDate(), journaledDates()]);
  const byDate = new Map<string, RuleTrade[]>();
  for (const r of rows) {
    if (!r.sessionDate) continue;
    const list = byDate.get(r.sessionDate) ?? [];
    list.push(tradeToRuleTrade(r));
    byDate.set(r.sessionDate, list);
  }
  return [...byDate].map(([sessionDate, trades]) => ({
    sessionDate,
    sentiment: sentiments.get(sessionDate) ?? null,
    journaled: journaled.has(sessionDate),
    trades,
  }));
}

export function toSpec(goal: GoalRow): GoalSpec {
  return { checkType: goal.checkType, threshold: goal.threshold, targetSessions: goal.targetSessions, startedAt: goal.createdAt, closedOn: goal.closedOn };
}

export interface GoalView {
  goal: GoalRow;
  evaluation: GoalEvaluation;
  baseline: { sessions: GoalSession[]; short: boolean };
  before: SessionMetrics;
  during: SessionMetrics;
}

function buildView(goal: GoalRow, sessions: GoalSession[], checkins: Map<string, boolean>): GoalView {
  const spec = toSpec(goal);
  const evaluation = evaluateGoal(spec, sessions, checkins);
  const baseline = baselineSessions(spec, sessions);
  const counted = new Set(evaluation.results.map((r) => r.sessionDate));
  return {
    goal,
    evaluation,
    baseline,
    before: sessionMetrics(baseline.sessions),
    during: sessionMetrics(sessions.filter((s) => counted.has(s.sessionDate))),
  };
}

/** Views for many goals off one trade load and one checkins query. */
export async function loadGoalViews(goalRows: GoalRow[]): Promise<GoalView[]> {
  if (goalRows.length === 0) return [];
  const [sessions, checkinRows] = await Promise.all([
    goalSessions(),
    db.select().from(goalCheckins).where(inArray(goalCheckins.goalId, goalRows.map((g) => g.id))),
  ]);
  const byGoal = new Map<number, Map<string, boolean>>();
  for (const r of checkinRows) {
    const m = byGoal.get(r.goalId) ?? new Map<string, boolean>();
    m.set(r.sessionDate, r.hit);
    byGoal.set(r.goalId, m);
  }
  return goalRows.map((g) => buildView(g, sessions, byGoal.get(g.id) ?? new Map()));
}

export async function loadGoalView(goal: GoalRow): Promise<GoalView> {
  return (await loadGoalViews([goal]))[0];
}
