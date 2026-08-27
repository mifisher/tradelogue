import { EventTime } from '@/components/event-time';
import type { StoredEconEvent } from '@/lib/market/brief-schema';
import { groupEconByDay } from '@/lib/market/brief-time';

interface EconCalendarProps {
  events: StoredEconEvent[];
  /** Current PT session date — drives the "today" band and the released dimming. */
  todayPt: string;
}

/** Impact reads as one heat ramp rather than three unrelated hues, so a red row
 * is unambiguously the one that moves the tape. Exported so the dashboard's
 * condensed card scores impact identically — two ramps would drift. */
export const ECON_IMPACT: Record<StoredEconEvent['impact'], { bar: string; name: string; label: string }> = {
  high: { bar: 'bg-loss', name: 'text-ondark font-semibold', label: 'High impact' },
  medium: { bar: 'bg-loss/45', name: 'text-ondark', label: 'Medium impact' },
  low: { bar: 'bg-stone/40', name: 'text-mute', label: 'Low impact' },
};

/** Every cell but the first carries a left rule — the column separation is the
 * whole point of scanning this like a Forex Factory table. */
const CELL = 'px-3 py-2 border-l border-hairline align-baseline';
const HEAD = `${CELL} font-normal text-[11px] uppercase tracking-wide text-stone`;

function dayLabel(date: string): { weekday: string; day: string } {
  const d = new Date(date + 'T12:00:00Z');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

export function EconCalendar({ events, todayPt }: EconCalendarProps) {
  const days = groupEconByDay(events);
  if (days.length === 0) {
    return <p className="text-sm text-mute">Nothing on the calendar this week.</p>;
  }

  return (
    <div className="-mx-2 px-2 overflow-x-auto">
      <table className="w-full min-w-[680px] border-separate border-spacing-0 text-sm">
        {/* Pinned so the header words cannot bid up narrow columns — the event
            name is what needs the width. */}
        <colgroup>
          <col className="w-[5.5rem]" />
          <col className="w-[6rem]" />
          <col className="w-[3.25rem]" />
          <col />
          <col className="w-[6.5rem]" />
          <col className="w-[6.5rem]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="px-1 py-2 text-left font-normal text-[11px] uppercase tracking-wide text-stone">
              Date
            </th>
            <th scope="col" className={`${HEAD} text-right`}>Time</th>
            <th scope="col" className={`${HEAD} text-left`}>Impact</th>
            <th scope="col" className={`${HEAD} text-left`}>Event</th>
            <th scope="col" className={`${HEAD} text-right`}>Forecast</th>
            <th scope="col" className={`${HEAD} text-right`}>Previous</th>
          </tr>
        </thead>
        <tbody>
          {days.map(({ date, events: dayEvents }, dayIndex) => {
            const isToday = date === todayPt;
            // Day-level only: a released-vs-pending check against the wall clock
            // would differ between server and client render.
            const isPast = date < todayPt;
            const { weekday, day } = dayLabel(date);
            const band = isToday ? 'bg-lift' : isPast ? 'opacity-60' : '';

            return dayEvents.map((event, rowIndex) => {
              const tone = ECON_IMPACT[event.impact];
              // A heavier rule opens each day; rows inside a day get the light one.
              const edge = rowIndex === 0
                ? dayIndex === 0 ? 'border-t border-hairline' : 'border-t-2 border-hairline'
                : 'border-t border-divider';

              return (
                <tr key={`${date}-${rowIndex}`} className={band}>
                  {rowIndex === 0 && (
                    <td rowSpan={dayEvents.length} className={`px-1 py-2 align-top ${edge}`}>
                      <div className={`text-[13px] uppercase tracking-wide font-semibold ${isToday ? 'text-ondark' : 'text-stone'}`}>
                        {weekday}
                      </div>
                      <div className={`text-[13px] ${isToday ? 'text-ondark' : 'text-mute'}`}>{day}</div>
                      {isToday && (
                        <div className="text-[11px] uppercase tracking-wide text-gain font-semibold mt-0.5">
                          Today
                        </div>
                      )}
                    </td>
                  )}

                  <td className={`${CELL} ${edge} text-right tabular whitespace-nowrap text-mute`}>
                    {event.timeUtc ? <EventTime utc={event.timeUtc} /> : <span className="text-stone">All day</span>}
                  </td>

                  <td className={`${CELL} ${edge}`}>
                    <span className={`block w-1.5 h-4 rounded-full ${tone.bar}`} aria-hidden />
                    <span className="sr-only">{tone.label}</span>
                  </td>

                  <td className={`${CELL} ${edge} ${tone.name}`}>
                    {event.name}
                    {event.note && <span className="text-stone text-[13px] ml-2">{event.note}</span>}
                  </td>

                  <td className={`${CELL} ${edge} text-right tabular whitespace-nowrap ${event.expected ? 'text-ondark' : 'text-stone'}`}>
                    {event.expected ?? '—'}
                  </td>

                  <td className={`${CELL} ${edge} text-right tabular whitespace-nowrap text-mute`}>
                    {event.previous ?? '—'}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-mute">
        {(['high', 'medium', 'low'] as const).map((level) => (
          <span key={level} className="flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-3.5 rounded-full ${ECON_IMPACT[level].bar}`} />
            {level[0].toUpperCase() + level.slice(1)}
          </span>
        ))}
        <span className="text-stone">· times in your local timezone · Forex Factory</span>
      </div>
    </div>
  );
}
