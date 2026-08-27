import Link from 'next/link';
import type { MarketBriefRow } from '@/lib/market-brief-actions';
import { BriefRefreshButton } from '@/components/brief-refresh-button';
import { EventTime } from '@/components/event-time';

interface MarketStripProps {
  row: MarketBriefRow | null;
  configured: boolean;
  latestFailure: string | null;
  todayPt: string;
}

/** Headlines and the brief's freshness. The index quotes moved to the rail's
 * IndexSnapshotsCard, where a vertical stack reads better than a four-across
 * grid — this section keeps the narrative half. */
export function MarketStrip({ row, configured, latestFailure, todayPt }: MarketStripProps) {
  if (!configured) return null; // dashboard stays clean until keys are added; /market has the guard copy

  const isToday = row?.briefDate === todayPt;

  return (
    <section className="mb-8">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <p className="text-[13px] uppercase tracking-widest text-stone mb-1">Market brief</p>
          <h2 className="font-display text-xl text-ondark">Top stories</h2>
        </div>
        <p className="text-[13px] text-stone">
          {row && (
            <>
              As of <EventTime utc={(row.quotes?.asOfUtc ?? row.generatedAt.toISOString())} mode="datetime" />
              {!isToday && <span className="text-loss"> · stale ({row.briefDate})</span>}
              {' · '}
            </>
          )}
          <Link href="/market" className="text-stone hover:text-ondark transition-colors">
            Full brief →
          </Link>
        </p>
      </div>

      {!row || !isToday ? (
        <div className="bg-elevated rounded-[20px] p-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-mute">
            {row ? `Latest brief is from ${row.briefDate}.` : 'No market brief yet.'}
            {latestFailure ? ` Last attempt failed: ${latestFailure}` : ''}
          </p>
          <BriefRefreshButton label="Generate today's brief" />
        </div>
      ) : (
        <div className="bg-elevated rounded-[20px] p-6">
          <ul className="space-y-2">
            {(row.brief?.topStories ?? []).slice(0, 3).map((s, i) => (
              <li key={i} className="text-sm text-ondark leading-snug">
                <Link href="/market" className="hover:underline">{s.headline}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
