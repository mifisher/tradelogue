'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startGoal } from '@/lib/goal-actions';
import { GOAL_CHECKS, GOAL_CHECK_TYPES, describeCheck, normalizeCheck, type GoalCheckType } from '@/lib/goals';
import type { PatternExperiment } from '@/lib/pattern-analysis';

const INPUT_CLS = 'bg-deep border border-hairline rounded-[12px] px-3 py-2 text-sm text-ondark w-full focus:outline-none focus:border-stone';
const LABEL_CLS = 'text-[13px] uppercase tracking-wide text-stone mb-1 block';

export function StartGoalDialog({ experiment, disabled = false }: { experiment: PatternExperiment; disabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const initial = normalizeCheck(experiment.check);
  const [type, setType] = useState<GoalCheckType>(initial.type);
  const [threshold, setThreshold] = useState(initial.threshold?.toString() ?? '');
  const [sessions, setSessions] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsThreshold = GOAL_CHECKS[type].needsThreshold;
  const check = { type, threshold: needsThreshold && threshold !== '' ? Number(threshold) : null };

  // An error describes the values that were submitted; any edit makes it stale.
  function edit(apply: () => void) {
    apply();
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await startGoal({
        title: experiment.title, hypothesis: experiment.hypothesis,
        protocol: experiment.protocol, successMetric: experiment.successMetric,
        check, targetSessions: Number(sessions),
      });
      if (!r.ok) return setError(r.error);
      ref.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? 'A goal is already active' : undefined}
        onClick={() => ref.current?.showModal()}
        className="shrink-0 rounded-full bg-ondark text-canvas px-4 h-8 font-semibold text-sm disabled:opacity-40"
      >
        Start
      </button>
      <dialog ref={ref} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[20px] bg-elevated p-6 text-ondark backdrop:bg-black/50">
        <form onSubmit={submit} className="space-y-4">
          <h2 className="font-display text-xl">{experiment.title}</h2>
          <div>
            <label className={LABEL_CLS} htmlFor="goal-check">Check</label>
            <select id="goal-check" className={INPUT_CLS} value={type} onChange={(e) => edit(() => setType(e.target.value as GoalCheckType))}>
              {GOAL_CHECK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <p className="mt-1 text-[12px] text-stone">{GOAL_CHECKS[type].prompt}</p>
          </div>
          {needsThreshold && (
            <div>
              <label className={LABEL_CLS} htmlFor="goal-threshold">Threshold</label>
              <input id="goal-threshold" type="number" step="any" required className={INPUT_CLS} value={threshold} onChange={(e) => edit(() => setThreshold(e.target.value))} />
            </div>
          )}
          <div>
            <label className={LABEL_CLS} htmlFor="goal-sessions">Sessions</label>
            <input id="goal-sessions" type="number" min={1} max={50} required className={INPUT_CLS} value={sessions} onChange={(e) => edit(() => setSessions(e.target.value))} />
          </div>
          {(!needsThreshold || threshold !== '') && <p className="text-sm text-mute">{describeCheck(check)}</p>}
          {error && <p className="text-sm text-loss">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} className="text-sm text-stone hover:text-ondark">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-full bg-ondark text-canvas px-5 h-9 font-semibold text-sm disabled:opacity-50">
              {pending ? 'Starting…' : 'Start experiment'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
