'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { abandonGoal, closeGoal, extendGoal, promoteGoal, type ActionResult } from '@/lib/goal-actions';

const BTN = 'rounded-full px-4 h-9 text-sm font-semibold disabled:opacity-50';

export function GoalDecisions({ goalId, finished }: { goalId: number; finished: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (id: number) => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn(goalId);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  if (!finished) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => confirm('Abandon this goal? It moves to history as dropped.') && run(abandonGoal)}
        className="text-sm text-stone hover:text-loss"
      >
        Abandon goal
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => run(promoteGoal)} className={`${BTN} bg-ondark text-canvas`}>Make it a rule</button>
      <button type="button" disabled={pending} onClick={() => run(extendGoal)} className={`${BTN} bg-deep text-ondark`}>Extend +10</button>
      <button type="button" disabled={pending} onClick={() => run(closeGoal)} className={`${BTN} bg-deep text-ondark`}>Close</button>
      {error && <span className="text-sm text-loss">{error}</span>}
    </div>
  );
}
