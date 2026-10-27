import type { SessionResult } from '@/lib/goals';

export function GoalDots({ results, target }: { results: SessionResult[]; target: number }) {
  const hits = results.filter((r) => r.hit).length;
  return (
    <div className="flex flex-wrap gap-1.5" role="img" aria-label={`${hits} hit of ${results.length} sessions, target ${target}`}>
      {Array.from({ length: target }, (_, i) => {
        const r = results[i];
        const tone = !r ? 'bg-hairline' : r.hit ? 'bg-gain' : 'bg-loss';
        return (
          <span
            key={i}
            title={r ? `${r.sessionDate}: ${r.hit ? 'hit' : `miss: ${r.reason}`}` : 'remaining'}
            className={`h-2.5 w-2.5 rounded-full ${tone}`}
          />
        );
      })}
    </div>
  );
}
