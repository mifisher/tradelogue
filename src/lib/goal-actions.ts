'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { goals, tradingRules } from '@/db/schema';
import { GOAL_CHECKS, describeCheck, parseStartGoalInput } from '@/lib/goals';
import { insertTradingRule } from '@/lib/trading-rules';
import { sessionDate } from '@/lib/daily-pnl';

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateGoals() {
  try {
    revalidatePath('/', 'layout'); // card renders in three page rails + /goals
  } catch {
    // ignore Next.js context errors outside request handling
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const today = () => sessionDate(new Date());
const activeById = (id: number) => and(eq(goals.id, id), eq(goals.status, 'active'));

export async function startGoal(input: unknown): Promise<ActionResult> {
  let parsed;
  try {
    parsed = parseStartGoalInput(input);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  try {
    await db.insert(goals).values({
      title: parsed.title,
      hypothesis: parsed.hypothesis,
      protocol: parsed.protocol,
      successMetric: parsed.successMetric,
      checkType: parsed.check.type,
      threshold: parsed.check.threshold,
      targetSessions: parsed.targetSessions,
      startedOn: today(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'A goal is already active' };
    throw err;
  }
  revalidateGoals();
  return { ok: true };
}

// ponytail: Extend only checks the goal is active; the UI shows it only once
// the goal is finished. Evaluate server-side here if Extend is ever reachable earlier.
export async function extendGoal(id: number): Promise<ActionResult> {
  await db.update(goals).set({ targetSessions: sql`${goals.targetSessions} + 10` }).where(activeById(id));
  revalidateGoals();
  return { ok: true };
}

export async function closeGoal(id: number): Promise<ActionResult> {
  await db.update(goals).set({ status: 'completed', closedOn: today() }).where(activeById(id));
  revalidateGoals();
  return { ok: true };
}

export async function abandonGoal(id: number): Promise<ActionResult> {
  await db.update(goals).set({ status: 'dropped', closedOn: today() }).where(activeById(id));
  revalidateGoals();
  return { ok: true };
}

export async function promoteGoal(id: number): Promise<ActionResult> {
  const result = await db.transaction(async (tx) => {
    // Claim first: the conditional update row-locks the goal, so a second tab
    // waits here, then sees it's no longer active and creates no rule.
    const [goal] = await tx
      .update(goals)
      .set({ status: 'promoted', closedOn: today() })
      .where(activeById(id))
      .returning();
    if (!goal) return { ok: false, error: 'This goal is already closed' } as const;

    // The new rule replaces any enabled rule with the same check, so one
    // trade isn't counted twice. Disabled, not deleted: re-enable on /rules.
    const detector = GOAL_CHECKS[goal.checkType].detector;
    if (detector) {
      await tx
        .update(tradingRules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(and(eq(tradingRules.detector, detector), eq(tradingRules.enabled, true), isNull(tradingRules.deletedAt)));
    }

    // Same transaction: if the insert fails, the claim and the disable roll back too.
    const rule = await insertTradingRule(tx, {
      title: goal.title,
      description: `${describeCheck({ type: goal.checkType, threshold: goal.threshold })}. ${goal.protocol}`,
      enabled: true,
      detector,
      threshold: goal.threshold,
    });
    await tx.update(goals).set({ ruleId: rule.id }).where(eq(goals.id, id));
    return { ok: true } as const;
  });
  if (result.ok) revalidateGoals();
  return result;
}
