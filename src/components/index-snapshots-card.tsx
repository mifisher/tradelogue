import Link from 'next/link';
import { Card } from '@/components/card';
import { EventTime } from '@/components/event-time';
import type { MarketBriefRow } from '@/lib/market-brief-actions';
import type { AssetQuote } from '@/lib/market/brief-schema';

interface IndexSnapshotsCardProps {
  row: MarketBriefRow | null;
  todayPt: string;
}

/** Thousands-separated to 2dp — indexes stay unchanged, BTC stays readable. */
const numFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Fixed reading order rather than whatever order the gather happened to push:
 * the two indexes the trader trades, then the volatility read, then crypto. A
 * failed quote drops its row without shuffling the rest. */
const SYMBOL_ORDER = ['SPY', 'QQQ', 'VIX', 'BTC'];

function orderAssets(assets: AssetQuote[]): AssetQuote[] {
  const bySymbol = new Map(assets.map((a) => [a.symbol, a]));
  const ordered = SYMBOL_ORDER.map((s) => bySymbol.get(s)).filter((a): a is AssetQuote => !!a);
  // Anything the order list does not know about still shows, after the knowns.
  const extras = assets.filter((a) => !SYMBOL_ORDER.includes(a.symbol));
  return [...ordered, ...extras];
}

function AssetRow({ asset }: { asset: AssetQuote }) {
  const up = asset.change >= 0;
  const tone = up ? 'text-gain' : 'text-loss';
  const sign = up ? '+' : '';
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] text-stone uppercase tracking-wide truncate">{asset.label}</p>
        <p className={`text-sm font-semibold tabular shrink-0 ${tone}`}>
          {sign}{asset.changePct.toFixed(2)}%
        </p>
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5">
        <p className="font-display text-2xl tabular text-ondark">{numFmt.format(asset.value)}</p>
        <p className={`text-[13px] tabular shrink-0 ${tone}`}>
          {sign}{numFmt.format(asset.change)}
        </p>
      </div>
    </div>
  );
}

/** The tape at a glance, stacked for the rail.
 *
 * Prices show only when the brief is the current session's. A stale quote
 * rendered as a live one is the worst thing this card could do, so an old brief
 * gets the date instead of numbers. */
export function IndexSnapshotsCard({ row, todayPt }: IndexSnapshotsCardProps) {
  const isToday = row?.briefDate === todayPt;
  const assets = isToday ? orderAssets(row?.quotes?.assets ?? []) : [];

  return (
    <Card title="Index snapshots">
      {assets.length === 0 ? (
        <p className="text-sm text-mute">
          {row ? `No current snapshot — latest brief is from ${row.briefDate}.` : 'No market brief yet.'}
        </p>
      ) : (
        <div className="divide-y divide-divider">
          {assets.map((a) => (
            <AssetRow key={a.symbol} asset={a} />
          ))}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-divider flex items-baseline justify-between gap-2">
        <Link href="/market" className="text-stone hover:text-ondark text-sm transition-colors">
          Full brief →
        </Link>
        {row && isToday && (
          <span className="text-[13px] text-stone">
            <EventTime utc={row.quotes?.asOfUtc ?? row.generatedAt.toISOString()} />
          </span>
        )}
      </div>
    </Card>
  );
}
