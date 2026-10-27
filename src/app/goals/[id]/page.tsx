import { notFound } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { GoalReadout } from '@/components/goals/goal-readout';
import { getGoal, loadGoalView } from '@/lib/goal-queries';

export const dynamic = 'force-dynamic';

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const goal = /^\d+$/.test(id) ? await getGoal(Number(id)) : null;
  if (!goal) notFound();
  return (
    <PageShell>
      <GoalReadout view={await loadGoalView(goal)} actions={false} />
    </PageShell>
  );
}
