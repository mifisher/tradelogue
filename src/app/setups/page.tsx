import Link from 'next/link';
import { getSetupSuggestions, getSetups, tradesForAllSetups, toStatTrade } from '@/lib/queries';
import { computeStats } from '@/lib/stats';
import { fmtPct } from '@/lib/format';
import { Card } from '@/components/card';
import { Pnl } from '@/components/pnl';
import { SetupRescanButton } from '@/components/setup-rescan-button';
import { SetupSuggestionsReview } from '@/components/setup-suggestions-review';

export const dynamic = 'force-dynamic';

export default async function SetupsPage() {
  const [allSetups, setupTradesMap, setupSuggestions] = await Promise.all([
    getSetups(),
    tradesForAllSetups(),
    getSetupSuggestions(),
  ]);

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <h1 className="font-display text-3xl text-ondark">Setups</h1>
        <SetupRescanButton />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {allSetups.map((setup) => {
          const setupTrades = setupTradesMap.get(setup.number) ?? [];
          const stats = setupTrades.length > 0
            ? computeStats(setupTrades.map(toStatTrade))
            : null;

          return (
            <Link
              key={setup.number}
              href={`/setups/${setup.number}`}
              className="block hover:bg-lift transition-colors rounded-[20px]"
            >
              <Card>
                {/* Top row: number badge + name */}
                <div className="flex items-center gap-3 mb-2">
                  <span className="bg-deep rounded-full px-3 py-0.5 text-[13px] text-stone shrink-0">
                    {setup.number}
                  </span>
                  <span className="font-display text-xl text-ondark">
                    {setup.name}
                  </span>
                </div>

                {/* alsoCalled */}
                {setup.alsoCalled && (
                  <p className="text-stone text-sm mb-3 ml-[calc(1.5rem+12px)]">
                    {setup.alsoCalled}
                  </p>
                )}

                {/* Description excerpt */}
                {setup.description && (
                  <p className="line-clamp-3 text-sm text-mute mb-4">
                    {setup.description}
                  </p>
                )}

                {/* Stats line */}
                {stats !== null ? (
                  <p className="text-sm text-stone">
                    {stats.tradeCount} trade{stats.tradeCount !== 1 ? 's' : ''}&nbsp;&middot;&nbsp;
                    win rate {fmtPct(stats.winRate)}&nbsp;&middot;&nbsp;
                    <Pnl value={stats.totalPnl} />
                  </p>
                ) : (
                  <p className="text-sm text-stone">No tagged trades yet</p>
                )}
              </Card>
            </Link>
          );
        })}
      </div>

      <SetupSuggestionsReview initialRows={setupSuggestions} />
    </main>
  );
}
