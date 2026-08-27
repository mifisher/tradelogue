import Link from 'next/link';
import { Pnl } from '@/components/pnl';
import type { MonthView } from '@/lib/calendar';

interface MonthGridProps {
  mv: MonthView;
  journaledDates?: string[];
}

const GAIN_COLOR = 'var(--color-gain)';
const LOSS_COLOR = 'var(--color-loss)';

export function MonthGrid({ mv, journaledDates = [] }: MonthGridProps) {
  const journaledSet = new Set(journaledDates);
  if (mv.weeks.length === 0) {
    return (
      <p className="text-mute text-center py-16">
        No sessions in {mv.title}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <div className="min-w-[680px]">
      {/* Column headers */}
      <div className="grid grid-cols-6 gap-2 mb-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
          <div key={d} className="text-[13px] text-stone uppercase tracking-wide text-center">
            {d}
          </div>
        ))}
        <div className="text-[13px] text-stone uppercase tracking-wide text-right pr-1">
          Week
        </div>
      </div>

      {/* Week rows */}
      <div className="flex flex-col gap-2">
        {mv.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-6 gap-2">
            {week.cells.map((cell, ci) => {
              // Placeholder cell — invisible, keeps grid alignment
              if (cell.date === '') {
                return <div key={ci} className="min-h-24 rounded-[12px]" aria-hidden="true" />;
              }

              // Non-traded in-month weekday — link to day page for journaling
              if (!cell.summary) {
                const dayNum = parseInt(cell.date.slice(8), 10);
                const isJournaled = journaledSet.has(cell.date);
                return (
                  <Link
                    key={ci}
                    href={`/day/${cell.date}`}
                    className="relative bg-deep opacity-50 rounded-[12px] p-4 min-h-24 hover:bg-lift hover:opacity-70 transition-colors block no-underline"
                  >
                    <span className="text-[13px] text-stone">{dayNum}</span>
                    {isJournaled && (
                      <span
                        className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-stone"
                        title="Journaled"
                      />
                    )}
                  </Link>
                );
              }

              // Traded day
              const { summary } = cell;
              const dayNum = parseInt(cell.date.slice(8), 10);
              const borderColor = summary.pnl > 0 ? GAIN_COLOR : LOSS_COLOR;
              const isJournaled = journaledSet.has(cell.date);

              return (
                <Link
                  key={ci}
                  href={`/day/${cell.date}`}
                  className="relative bg-elevated rounded-[12px] p-4 min-h-24 border-l-2 hover:bg-lift transition-colors flex flex-col gap-1 no-underline"
                  style={{ borderLeftColor: borderColor }}
                >
                  <span className="text-[13px] text-stone">{dayNum}</span>
                  {isJournaled && (
                    <span
                      className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-stone"
                      title="Journaled"
                    />
                  )}
                  <Pnl value={summary.pnl} whole className="text-lg" />
                  <span className="text-[13px] text-mute">
                    {summary.tradeCount} {summary.tradeCount === 1 ? 'trade' : 'trades'}
                  </span>
                </Link>
              );
            })}

            {/* Week total */}
            <div className="flex items-center justify-end pr-1 min-h-24">
              {week.weekPnl !== null ? (
                <Pnl value={week.weekPnl} whole className="text-sm" />
              ) : (
                <span className="text-stone text-sm">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
