import Link from 'next/link';
import { Card } from '@/components/card';
import { EventTime } from '@/components/event-time';
import { ECON_IMPACT } from '@/components/econ-calendar';
import type { StoredEconEvent } from '@/lib/market/brief-schema';

interface TodayEconCardProps {
  /** The whole week from the brief; this card narrows it to today itself. */
  events: StoredEconEvent[];
  todayPt: string;
}

/** Today's releases, condensed for the 340px dashboard rail. The full table on
 * /market carries previous values and the rest of the week; here the glance is
 * "what prints today, when, and does it matter", so Previous is dropped and the
 * event name takes the width it frees. */
export function TodayEconCard({ events, todayPt }: TodayEconCardProps) {
  const today = events.filter((e) => e.date === todayPt);

  return (
    <Card title="Economic calendar">
      {today.length === 0 ? (
        <p className="text-sm text-mute">Nothing scheduled today.</p>
      ) : (
        <div className="divide-y divide-divider">
          {today.map((event, i) => {
            const tone = ECON_IMPACT[event.impact];
            return (
              <div key={i} className="flex items-baseline gap-2 py-2 first:pt-0">
                <span className="w-16 shrink-0 text-[13px] tabular text-stone">
                  {event.timeUtc ? <EventTime utc={event.timeUtc} /> : 'All day'}
                </span>
                <span className={`w-1 h-3.5 shrink-0 rounded-full self-center ${tone.bar}`} aria-hidden />
                <span className="sr-only">{tone.label}</span>
                {/* Wraps rather than truncates: the rail cannot fit "Core PCE
                    Price Index m/m" on one line, and a clipped name is the one
                    thing this card exists to tell you. */}
                <span className={`flex-1 min-w-0 text-sm ${tone.name}`}>{event.name}</span>
                {event.expected && (
                  <span className="shrink-0 text-[13px] tabular text-mute">{event.expected}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-divider">
        <Link href="/market" className="text-stone hover:text-ondark text-sm transition-colors">
          Full calendar →
        </Link>
      </div>
    </Card>
  );
}
