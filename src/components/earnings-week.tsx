import type { EarningsItem } from '@/lib/market/brief-schema';
import {
  earningsPriority,
  tradedSet,
  type EarningsPriority as Priority,
} from '@/lib/market/earnings-priority';

interface EarningsWeekProps {
  /** The five session dates, oldest first (see earningsWindow). */
  window: string[];
  earnings: EarningsItem[];
  todayPt: string;
  /** Underlyings the trader has traded — highlighted with a green rail. */
  tradedTickers?: string[];
}

const SESSIONS: { key: EarningsItem['timing']; label: string }[] = [
  { key: 'BMO', label: 'Before open' },
  { key: 'AMC', label: 'After close' },
  { key: 'unknown', label: 'Time TBD' },
];

function dayLabel(date: string): { weekday: string; day: string } {
  const d = new Date(date + 'T12:00:00Z');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

function Ticker({ item, priority }: { item: EarningsItem; priority: Priority }) {
  // Company and any watch note ride along as the tooltip: the column is too
  // narrow for them, but they are the difference between a ticker and a name.
  const tooltip = [item.company, item.watchItem].filter(Boolean).join(' — ');
  const rail =
    priority === 'traded'
      ? 'border-l-2 border-gain pl-2'
      : priority === 'watch'
      ? 'border-l-2 border-cobalt pl-2'
      : 'pl-2.5';
  return (
    <div className={`flex items-baseline justify-between gap-2 py-1.5 ${rail}`} title={tooltip}>
      <span
        className={`text-sm tabular truncate ${
          priority ? 'text-ondark font-semibold' : 'text-mute'
        }`}
      >
        {item.ticker}
      </span>
      {item.epsEstimate && (
        <span className="text-stone text-[13px] tabular shrink-0">{item.epsEstimate}</span>
      )}
    </div>
  );
}

export function EarningsWeek({ window, earnings, todayPt, tradedTickers = [] }: EarningsWeekProps) {
  const traded = tradedSet(tradedTickers);
  const priorityOf = (ticker: string): Priority => earningsPriority(ticker, traded);

  const byDate = new Map<string, EarningsItem[]>();
  for (const item of earnings) {
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(item);
    else byDate.set(item.date, [item]);
  }

  return (
    // Five columns never fit a phone; let the row scroll rather than squeeze
    // the tickers. -mx-2/px-2 keeps the focus ring from clipping at the edges.
    <div className="-mx-2 px-2 overflow-x-auto">
      <div className="grid grid-cols-5 gap-px bg-hairline rounded-[20px] overflow-hidden min-w-[760px]">
        {window.map((date) => {
          const isToday = date === todayPt;
          const { weekday, day } = dayLabel(date);
          const dayItems = byDate.get(date) ?? [];

          return (
            <div key={date} className={`p-4 ${isToday ? 'bg-lift' : 'bg-deep'}`}>
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-[13px] uppercase tracking-wide font-semibold ${
                      isToday ? 'text-ondark' : 'text-stone'
                    }`}
                  >
                    {weekday}
                  </span>
                  {isToday && (
                    <span className="text-[11px] uppercase tracking-wide text-gain font-semibold">
                      Today
                    </span>
                  )}
                </div>
                <div className={`text-sm ${isToday ? 'text-ondark' : 'text-mute'}`}>{day}</div>
              </div>

              {dayItems.length === 0 ? (
                <p className="text-[13px] text-stone">—</p>
              ) : (
                SESSIONS.map(({ key, label }) => {
                  const sessionItems = dayItems.filter((e) => e.timing === key);
                  if (sessionItems.length === 0) return null;

                  // Pin the highlighted names to the top of the session, keeping
                  // each group in its incoming rank order.
                  const priority = sessionItems.filter((e) => priorityOf(e.ticker));
                  const rest = sessionItems.filter((e) => !priorityOf(e.ticker));

                  return (
                    <div key={key} className="mt-3 first:mt-0">
                      <p className="text-[11px] uppercase tracking-wide text-stone pb-1 mb-0.5 border-b border-divider">
                        {label}
                      </p>
                      {priority.length > 0 && (
                        <div className="divide-y divide-divider">
                          {priority.map((item) => (
                            <Ticker
                              key={`${item.ticker}-${item.date}`}
                              item={item}
                              priority={priorityOf(item.ticker)}
                            />
                          ))}
                        </div>
                      )}
                      {priority.length > 0 && rest.length > 0 && (
                        <div className="border-t border-dashed border-hairline my-1" />
                      )}
                      {rest.length > 0 && (
                        <div className="divide-y divide-divider">
                          {rest.map((item) => (
                            <Ticker key={`${item.ticker}-${item.date}`} item={item} priority={null} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-0.5 h-3.5 bg-gain rounded-full" />
          Traded
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-0.5 h-3.5 bg-cobalt rounded-full" />
          Watchlist
        </span>
        <span className="text-stone">· highlighted names sorted to top</span>
      </div>
    </div>
  );
}
