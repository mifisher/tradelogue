import { Suspense } from 'react';
import { closedTrades, toStatTrade, underlyings, getAnnotationsByExecIds } from '@/lib/queries';
import { computeStats } from '@/lib/stats';
import { fmtPct } from '@/lib/format';
import { Card } from '@/components/card';
import { Pnl } from '@/components/pnl';
import { PillLink } from '@/components/pill-link';
import { TradesTable } from '@/components/trades-table';
import { TickerSelect } from '@/components/ticker-select';

export const dynamic = 'force-dynamic';

interface TradesPageProps {
  searchParams: Promise<{
    ticker?: string;
    dir?: string;
    result?: string;
  }>;
}

/** Build a query string merging current params with one override key/value (null = delete) */
function buildHref(
  base: Record<string, string>,
  key: string,
  value: string | null,
): string {
  const params = new URLSearchParams(base);
  if (value === null || value === '') {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const str = params.toString();
  return str ? `/trades?${str}` : '/trades';
}

export default async function TradesPage({ searchParams }: TradesPageProps) {
  const sp = await searchParams;

  // Sanitize params — only accept known valid values
  const ticker = typeof sp.ticker === 'string' && sp.ticker.length > 0 ? sp.ticker : '';
  const dir =
    sp.dir === 'long' || sp.dir === 'short' ? sp.dir : '';
  const result =
    sp.result === 'win' || sp.result === 'loss' ? sp.result : '';

  // Current params as a plain record for building hrefs
  const currentParams: Record<string, string> = {};
  if (ticker) currentParams.ticker = ticker;
  if (dir) currentParams.dir = dir;
  if (result) currentParams.result = result;

  const [rows, allTickers] = await Promise.all([
    closedTrades({
      underlying: ticker || undefined,
      direction: dir as 'long' | 'short' | undefined || undefined,
      result: result as 'win' | 'loss' | undefined || undefined,
    }),
    underlyings(),
  ]);

  // Summary stats over filtered set
  const stats = computeStats(rows.map(toStatTrade));

  // Cap at 200 most recent (rows are already desc by openedAt)
  const CAP = 200;
  const capped = rows.slice(0, CAP);
  const isCapped = rows.length > CAP;

  // Fetch grades for the visible rows
  const execIds = capped
    .map((r) => r.firstExecId)
    .filter((id): id is string => id != null);
  const annotationsMap = await getAnnotationsByExecIds(execIds);
  const grades: Record<string, string> = {};
  for (const [execId, ann] of annotationsMap) {
    if (ann.grade) grades[execId] = ann.grade;
  }

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12">
      <h1 className="font-display text-3xl text-ondark mb-6">Trades</h1>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        {/* Result pills */}
        <PillLink href={buildHref(currentParams, 'result', null)} active={result === ''}>
          All
        </PillLink>
        <PillLink href={buildHref(currentParams, 'result', 'win')} active={result === 'win'}>
          Wins
        </PillLink>
        <PillLink href={buildHref(currentParams, 'result', 'loss')} active={result === 'loss'}>
          Losses
        </PillLink>

        {/* Divider dot */}
        <span className="text-stone text-sm select-none" aria-hidden>·</span>

        {/* Direction pills */}
        <PillLink href={buildHref(currentParams, 'dir', null)} active={dir === ''}>
          All
        </PillLink>
        <PillLink href={buildHref(currentParams, 'dir', 'long')} active={dir === 'long'}>
          Long
        </PillLink>
        <PillLink href={buildHref(currentParams, 'dir', 'short')} active={dir === 'short'}>
          Short
        </PillLink>

        {/* Ticker select (client) */}
        <Suspense fallback={null}>
          <TickerSelect tickers={allTickers} current={ticker} />
        </Suspense>
      </div>

      {/* ── Summary strip ── */}
      <p className="text-mute text-sm mb-6">
        {stats.tradeCount} trades &middot; win rate {fmtPct(stats.winRate)} &middot;{' '}
        <Pnl value={stats.totalPnl} />
      </p>

      {/* ── Table ── */}
      <Card>
        {isCapped && (
          <p className="text-stone text-[13px] mb-4">
            Showing {CAP} of {rows.length} trades (most recent first)
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-mute text-center py-12">No trades match the current filters.</p>
        ) : (
          <TradesTable rows={capped} showDate={true} grades={grades} />
        )}
      </Card>
    </main>
  );
}
