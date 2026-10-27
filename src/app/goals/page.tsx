import Link from 'next/link';
import { PageShell } from '@/components/page-shell';
import { Card } from '@/components/card';
import { GoalReadout } from '@/components/goals/goal-readout';
import { GoalsCard } from '@/components/goals/goals-card';
import { closedGoals, getActiveGoal, loadGoalViews } from '@/lib/goal-queries';
import { getTradingRules } from '@/lib/trading-rules';
import { GOAL_CHECKS } from '@/lib/goals';

export const dynamic = 'force-dynamic';

export default async function GoalsPage() {
  const [active, history] = await Promise.all([getActiveGoal(), closedGoals()]);
  const views = await loadGoalViews(active ? [active, ...history] : history);
  const view = active ? views[0] : null;
  const historyViews = active ? views.slice(1) : views;
  // Enabled rules that "Make it a rule" would disable (same check as the goal).
  const detector = active ? GOAL_CHECKS[active.checkType].detector : null;
  const replaces = detector
    ? (await getTradingRules()).filter((r) => r.enabled && r.detector === detector)
    : [];

  return (
    <PageShell className="space-y-6">
      {/* No active goal: the card renders the suggested experiments with Start. */}
      {view ? <GoalReadout view={view} actions replaces={replaces} /> : <GoalsCard />}
      <Card title="History">
        {historyViews.length === 0 ? (
          <p className="text-sm text-mute">No finished goals yet.</p>
        ) : (
          <div className="divide-y divide-divider">
            {historyViews.map(({ goal, evaluation: ev }) => (
              <Link key={goal.id} href={`/goals/${goal.id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-lift -mx-8 px-8">
                <span className="text-sm font-semibold text-ondark">{goal.title}</span>
                <span className="text-sm text-stone tabular shrink-0">{ev.hits} / {ev.counted} hit · {goal.status}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
}
