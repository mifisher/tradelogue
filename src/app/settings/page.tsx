import { loadSetupValues } from '@/lib/setup/actions';
import { setupState } from '@/lib/setup/state';
import { PAGE_NARROW } from '@/lib/layout';
import { DatabaseSection } from '@/components/setup/database-section';
import { TradingDaySection } from '@/components/setup/trading-day-section';
import { AiSection } from '@/components/setup/ai-section';
import { IbkrSection } from '@/components/setup/ibkr-section';
import { MarketSection } from '@/components/setup/market-section';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { values, masked } = await loadSetupValues();
  const state = setupState();
  const shared = { initial: values, masked };

  return (
    <div className={`${PAGE_NARROW} mx-auto px-6 py-12 space-y-6`}>
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-ondark">Settings</h1>
        <p className="text-mute text-sm leading-relaxed max-w-2xl">
          Written to <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">.env</code>. The
          dev server reloads itself when that file changes; under{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">next start</code> you have to
          restart it yourself, and a timezone change needs a rebuild because it is inlined at build
          time.
        </p>
      </header>

      <DatabaseSection {...shared} done={state.database} />
      <TradingDaySection {...shared} done={state.timezone} />
      <AiSection {...shared} done={state.ai} />
      <IbkrSection {...shared} done={state.ibkr} />
      <MarketSection {...shared} done={state.market} />
    </div>
  );
}
