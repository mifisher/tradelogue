import Link from 'next/link';
import { Card } from '@/components/card';
import type { EarningsItem } from '@/lib/market/brief-schema';
import { earningsPriority, tradedSet, type EarningsPriority } from '@/lib/market/earnings-priority';

interface TodayEarningsCardProps {
  /** The whole week from the brief; this card narrows it to today itself. */
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

/** Enough to see the session's shape in a narrow rail without the card growing
 * taller than Recent sessions; the rest is one click away on /market. */
const PER_SESSION = 6;

function Row({ item, priority }: { item: EarningsItem; priority: EarningsPriority }) {
  const rail =
    priority === 'traded'
      ? 'border-l-2 border-gain pl-2'
      : priority === 'watch'
      ? 'border-l-2 border-cobalt pl-2'
      : 'pl-2.5';
  return (
    <div
      className={`flex items-baseline justify-between gap-2 py-1.5 ${rail}`}
      title={[item.company, item.watchItem].filter(Boolean).join(' — ')}
    >
      <span className={`text-sm tabular truncate ${priority ? 'text-ondark font-semibold' : 'text-mute'}`}>
        {item.ticker}
      </span>
      {item.epsEstimate && (
        <span className="shrink-0 text-[13px] tabular text-stone">{item.epsEstimate}</span>
      )}
    </div>
  );
}

/** Today's reporters split by session — the only cut that changes how the day
 * is traded, since a before-open name is already news by the open and an
 * after-close name is a position you cannot carry. */
export function TodayEarningsCard({ earnings, todayPt, tradedTickers = [] }: TodayEarningsCardProps) {
  const today = earnings.filter((e) => e.date === todayPt);
  const traded = tradedSet(tradedTickers);
  const priorityOf = (ticker: string) => earningsPriority(ticker, traded);

  return (
    <Card title="Earnings today">
      {today.length === 0 ? (
        <p className="text-sm text-mute">No earnings scheduled today.</p>
      ) : (
        SESSIONS.map(({ key, label }) => {
          const items = today.filter((e) => e.timing === key);
          if (items.length === 0) return null;

          // Highlighted names first so a traded or watchlist reporter is never
          // the one pushed past the cut.
          const ranked = [
            ...items.filter((e) => priorityOf(e.ticker)),
            ...items.filter((e) => !priorityOf(e.ticker)),
          ];
          const shown = ranked.slice(0, PER_SESSION);
          const hidden = ranked.length - shown.length;

          return (
            <div key={key} className="mt-4 first:mt-0">
              <p className="text-[11px] uppercase tracking-wide text-stone pb-1 mb-1 border-b border-divider">
                {label}
              </p>
              <div className="divide-y divide-divider">
                {shown.map((item) => (
                  <Row key={item.ticker} item={item} priority={priorityOf(item.ticker)} />
                ))}
              </div>
              {hidden > 0 && (
                <p className="text-[13px] text-stone pl-2.5 pt-1.5">+{hidden} more</p>
              )}
            </div>
          );
        })
      )}

      <div className="mt-6 pt-4 border-t border-divider">
        <Link href="/market" className="text-stone hover:text-ondark text-sm transition-colors">
          Full week →
        </Link>
      </div>
    </Card>
  );
}
