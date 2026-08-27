import { notFound } from 'next/navigation';
import { getSetup, tradesBySetup, toStatTrade } from '@/lib/queries';
import { computeStats } from '@/lib/stats';
import { fmtPct, fmtMoney } from '@/lib/format';
import { Card } from '@/components/card';
import { TradesTable } from '@/components/trades-table';

export const dynamic = 'force-dynamic';

interface SetupDetailPageProps {
  params: Promise<{ number: string }>;
}

type PlaybookField = {
  label: string;
  key: 'description' | 'whyItWorks' | 'entryCriteria' | 'target' | 'management' | 'stopPlacement' | 'idealConditions' | 'watchOuts';
};

const PLAYBOOK_FIELDS: PlaybookField[] = [
  { label: 'Pattern', key: 'description' },
  { label: 'Why it works', key: 'whyItWorks' },
  { label: 'Entry criteria', key: 'entryCriteria' },
  { label: 'Target', key: 'target' },
  { label: 'Management', key: 'management' },
  { label: 'Stop placement', key: 'stopPlacement' },
  { label: 'Ideal conditions', key: 'idealConditions' },
  { label: 'Watch-outs', key: 'watchOuts' },
];

export default async function SetupDetailPage({ params }: SetupDetailPageProps) {
  const { number: numberParam } = await params;

  // Validate: must be integer 1–99
  const parsed = parseInt(numberParam, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 99 || String(parsed) !== numberParam) {
    notFound();
  }

  const [setup, taggedTrades] = await Promise.all([
    getSetup(parsed),
    tradesBySetup(parsed),
  ]);

  if (!setup) notFound();

  const stats = taggedTrades.length > 0
    ? computeStats(taggedTrades.map(toStatTrade))
    : null;

  const avgPnl = stats && stats.tradeCount > 0
    ? stats.totalPnl / stats.tradeCount
    : null;

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="bg-deep rounded-full px-3 py-0.5 text-[13px] text-stone shrink-0">
            {setup.number}
          </span>
          <h1 className="font-display text-3xl text-ondark">
            {setup.name}
          </h1>
        </div>
        {setup.alsoCalled && (
          <p className="text-stone text-sm mt-1 ml-[calc(1.5rem+12px)]">
            {setup.alsoCalled}
          </p>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-hairline rounded-[20px] overflow-hidden mb-8">
        <div className="bg-deep p-6">
          <p className="text-[13px] uppercase tracking-wide text-stone mb-1">Tagged trades</p>
          <p className="font-display text-3xl text-ondark">
            {stats ? stats.tradeCount : '—'}
          </p>
        </div>
        <div className="bg-deep p-6">
          <p className="text-[13px] uppercase tracking-wide text-stone mb-1">Win rate</p>
          <p className={`font-display text-3xl ${stats ? (stats.winRate >= 0.5 ? 'text-gain' : 'text-loss') : 'text-ondark'}`}>
            {stats ? fmtPct(stats.winRate) : '—'}
          </p>
        </div>
        <div className="bg-deep p-6">
          <p className="text-[13px] uppercase tracking-wide text-stone mb-1">Total P&amp;L</p>
          <p className={`font-display text-3xl tabular ${stats ? (stats.totalPnl >= 0 ? 'text-gain' : 'text-loss') : 'text-ondark'}`}>
            {stats ? fmtMoney(stats.totalPnl) : '—'}
          </p>
        </div>
        <div className="bg-deep p-6">
          <p className="text-[13px] uppercase tracking-wide text-stone mb-1">Avg P&amp;L</p>
          <p className={`font-display text-3xl tabular ${avgPnl !== null ? (avgPnl >= 0 ? 'text-gain' : 'text-loss') : 'text-ondark'}`}>
            {avgPnl !== null ? fmtMoney(avgPnl) : '—'}
          </p>
        </div>
      </div>

      {/* Playbook card */}
      <Card title="Playbook" className="mb-8">
        <div className="space-y-6">
          {PLAYBOOK_FIELDS.map(({ label, key }) => {
            const value = setup[key];
            if (!value) return null;
            return (
              <div key={key}>
                <p className="text-[13px] uppercase tracking-wide text-stone mb-2">
                  {label}
                </p>
                <p className="whitespace-pre-wrap text-sm text-mute leading-relaxed">
                  {value}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Tagged trades */}
      <Card title="Tagged trades">
        {taggedTrades.length === 0 ? (
          <p className="text-stone text-sm">No tagged trades yet.</p>
        ) : (
          <TradesTable rows={taggedTrades} showDate />
        )}
      </Card>
    </main>
  );
}
