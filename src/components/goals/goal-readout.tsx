import Link from 'next/link';
import { Card } from '@/components/card';
import { GoalDots } from './goal-dots';
import { GoalDecisions } from './goal-decisions';
import { describeCheck, type SessionMetrics } from '@/lib/goals';
import type { GoalView } from '@/lib/goal-queries';
import { fmtMoney, fmtPct } from '@/lib/format';

const ROWS: Array<{ label: string; get: (m: SessionMetrics) => string }> = [
  { label: 'Day win rate', get: (m) => fmtPct(m.dayWinRate) },
  { label: 'Avg P&L / session', get: (m) => fmtMoney(m.avgPnl) },
  { label: 'Expectancy / trade', get: (m) => fmtMoney(m.expectancy) },
  { label: 'Avg trades / session', get: (m) => m.avgTrades.toFixed(1) },
];

export interface ReplacedRule { ruleNumber: number; title: string }

export function GoalReadout({ view, actions, replaces = [] }: { view: GoalView; actions: boolean; replaces?: ReplacedRule[] }) {
  const { goal, evaluation: ev, baseline, before, during } = view;
  return (
    <div className="space-y-6">
      <Card>
        <p className="text-[13px] uppercase tracking-wide text-stone">
          {goal.status === 'active' ? (ev.finished ? 'Experiment complete' : 'Current goal') : goal.status}
          {' · '}started {goal.startedOn}{goal.closedOn ? ` · closed ${goal.closedOn}` : ''}
        </p>
        <h1 className="font-display text-3xl text-ondark mt-2">{goal.title}</h1>
        <p className="text-sm text-mute mt-1">{describeCheck({ type: goal.checkType, threshold: goal.threshold })}</p>
        <div className="mt-5"><GoalDots results={ev.results} target={goal.targetSessions} /></div>
        <p className="mt-3 text-sm text-ondark tabular">{ev.counted} / {goal.targetSessions} sessions · {ev.hits} hit</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div><dt className="text-stone">Hypothesis</dt><dd className="text-ondark">{goal.hypothesis}</dd></div>
          <div><dt className="text-stone">Protocol</dt><dd className="text-ondark">{goal.protocol}</dd></div>
        </dl>
        {actions && goal.status === 'active' && (
          <div className="mt-6">
            {ev.finished && replaces.length > 0 && (
              <p className="mb-3 text-[13px] text-stone">
                Making it a rule replaces {replaces.map((r) => `R${r.ruleNumber} · ${r.title}`).join(', ')}, which will be disabled (re-enable it on Rules anytime).
              </p>
            )}
            <GoalDecisions goalId={goal.id} finished={ev.finished} />
          </div>
        )}
      </Card>

      {ev.finished && (
        <Card title="Results">
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="text-stone text-[13px] uppercase tracking-wide">
                <th className="text-left font-normal pb-2" />
                <th className="text-right font-normal pb-2">Before ({before.sessions})</th>
                <th className="text-right font-normal pb-2">During ({during.sessions})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <td className="py-2 text-mute">{r.label}</td>
                  <td className="py-2 text-right text-ondark">{r.get(before)}</td>
                  <td className="py-2 text-right text-ondark">{r.get(during)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 text-sm text-ondark"><span className="text-stone">Success metric: </span>{goal.successMetric}</p>
          <p className="mt-3 text-[12px] text-stone">
            {during.sessions} sessions is a small sample — read this as a direction, not proof.
            {baseline.short && ` Only ${before.sessions} sessions existed before the goal to compare against.`}
          </p>
        </Card>
      )}

      <Card title="Sessions">
        {ev.results.length === 0 && ev.awaitingJournal.length === 0 ? (
          <p className="text-sm text-mute">No sessions traded since the goal started.</p>
        ) : (
          <div className="divide-y divide-divider">
            {ev.results.map((r) => (
              <Link key={r.sessionDate} href={`/day/${r.sessionDate}`} className="flex items-start justify-between gap-4 py-3 hover:bg-lift -mx-8 px-8">
                <span className="text-sm font-semibold text-ondark shrink-0">{r.sessionDate}</span>
                <span className={`text-sm text-right ${r.hit ? 'text-gain' : 'text-loss'}`}>{r.hit ? 'hit' : `miss: ${r.reason}`}</span>
              </Link>
            ))}
            {ev.awaitingJournal.map((d) => (
              <Link key={d} href={`/day/${d}`} className="flex justify-between py-3 hover:bg-lift -mx-8 px-8">
                <span className="text-sm text-ondark">{d}</span>
                <span className="text-sm text-stone">waiting on journal</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
