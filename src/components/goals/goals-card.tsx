import Link from 'next/link';
import { Card } from '@/components/card';
import { GoalDots } from './goal-dots';
import { StartGoalDialog } from './start-goal-dialog';
import { getActiveGoal, loadGoalView } from '@/lib/goal-queries';
import { getLatestPatternAnalysis } from '@/lib/pattern-analysis-actions';
import { describeCheck, normalizeCheck } from '@/lib/goals';

const shortDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Goals rail card. `focusDate` (day journal page) adds that session's result. */
export async function GoalsCard({ focusDate }: { focusDate?: string }) {
  const goal = await getActiveGoal();

  if (!goal) {
    const analysis = await getLatestPatternAnalysis();
    const suggestions = analysis?.nextExperiments.slice(0, 3) ?? [];
    return (
      <Card title="Goals">
        {suggestions.length === 0 ? (
          <p className="text-sm text-mute">
            No suggested experiments yet. <Link href="/coach" className="text-ondark underline">Generate a pattern analysis →</Link>
          </p>
        ) : (
          <ul className="space-y-4">
            {suggestions.map((exp, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ondark leading-snug">{exp.title}</p>
                  <p className="text-[13px] text-stone mt-0.5">{describeCheck(normalizeCheck(exp.check))}</p>
                </div>
                <StartGoalDialog experiment={exp} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const { evaluation: ev } = await loadGoalView(goal);
  const last = ev.results.at(-1);
  const focus = focusDate ? ev.results.find((r) => r.sessionDate === focusDate) : undefined;
  const focusAwaiting = focusDate ? ev.awaitingJournal.includes(focusDate) : false;
  const waiting = ev.awaitingJournal.length;

  return (
    <Card title="Goals">
      <p className="text-sm font-semibold text-ondark leading-snug">{goal.title}</p>
      <p className="text-[13px] text-stone mt-0.5 mb-4">{describeCheck({ type: goal.checkType, threshold: goal.threshold })}</p>
      <GoalDots results={ev.results} target={goal.targetSessions} />
      {ev.finished ? (
        <p className="mt-3 text-sm text-ondark">Experiment complete: {ev.hits} / {ev.counted} hit</p>
      ) : (
        <p className="mt-3 text-sm text-mute tabular">{ev.counted} / {goal.targetSessions} sessions · {ev.hits} hit</p>
      )}
      {waiting > 0 && (
        <p className="mt-1 text-[13px] text-stone">
          {waiting} session{waiting > 1 ? 's' : ''} waiting on {waiting > 1 ? 'their' : 'its'} journal
        </p>
      )}
      {focus && (
        <p className={`mt-3 text-sm ${focus.hit ? 'text-gain' : 'text-loss'}`}>
          This session: {focus.hit ? 'hit ✓' : `miss ✗ (${focus.reason})`}
        </p>
      )}
      {!focus && focusAwaiting && <p className="mt-3 text-sm text-stone">This session: journal it to score it</p>}
      {!focusDate && last && (
        <p className="mt-2 text-[13px] text-stone">
          {shortDate(last.sessionDate)}: {last.hit ? 'hit' : `miss: ${last.reason}`}
        </p>
      )}
      <Link href="/goals" className="mt-5 block text-sm text-stone hover:text-ondark transition-colors">
        {ev.finished ? 'See results →' : 'Details →'}
      </Link>
    </Card>
  );
}
