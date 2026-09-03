'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DatabaseSection } from './database-section';
import { TradingDaySection } from './trading-day-section';
import { AiSection } from './ai-section';
import { IbkrSection } from './ibkr-section';
import { MarketSection } from './market-section';
import type { SetupState } from '@/lib/setup/state';

interface Props {
  values: Record<string, string>;
  masked: string[];
  state: SetupState;
}

export function SetupWizard({ values, masked, state }: Props) {
  const shared = { initial: values, masked };

  const steps = [
    { key: 'database', title: 'Database', required: true, done: state.database, node: <DatabaseSection {...shared} done={state.database} /> },
    { key: 'timezone', title: 'Your trading day', required: true, done: state.timezone, node: <TradingDaySection {...shared} done={state.timezone} /> },
    { key: 'ai', title: 'AI', required: false, done: state.ai, node: <AiSection {...shared} done={state.ai} /> },
    { key: 'ibkr', title: 'Interactive Brokers', required: false, done: state.ibkr, node: <IbkrSection {...shared} done={state.ibkr} /> },
    { key: 'market', title: 'Market data', required: false, done: state.market, node: <MarketSection {...shared} done={state.market} /> },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-3xl text-ondark">Set up Tradelogue</h1>
        <p className="text-mute leading-relaxed max-w-2xl">
          Everything runs on your machine, against your own Postgres, using your own API keys.
          Only the database and your timezone are required — the rest can wait, and each one
          switches on a feature rather than gating the app.
        </p>
        <p className="text-[13px] text-stone">
          {doneCount} of {steps.length} done · saved to{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">.env</code>, which is
          gitignored
        </p>
      </header>

      {steps.map((step, i) => (
        <Step key={step.key} index={i + 1} title={step.title} done={step.done} required={step.required}>
          {step.node}
        </Step>
      ))}

      {!state.needsSetup && (
        <section className="bg-elevated rounded-[20px] p-8 space-y-4">
          <h2 className="font-display text-xl text-ondark">Last thing: your rulebook</h2>
          <p className="text-mute text-sm leading-relaxed max-w-2xl">
            A fresh install seeds exactly one sample rule, to show the shape and to demonstrate a
            detector firing. Your rulebook encodes how you trade and what your account can absorb
            — someone else&rsquo;s would be worse than none.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Link href="/rules" className="h-11 inline-flex items-center rounded-full bg-ondark px-6 font-semibold text-canvas">
              Write your rules
            </Link>
            <Link href="/import" className="h-11 inline-flex items-center rounded-full border border-hairline px-6 font-semibold text-ondark">
              Import trades
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/** Done steps collapse to a one-line summary so the page stays about what is
 * left to do, without hiding what has already been set. */
function Step({
  index,
  title,
  done,
  required,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  required: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!done);

  if (!open) {
    return (
      <div className="bg-elevated rounded-[20px] px-8 py-5 flex items-center justify-between gap-4">
        <span className="text-sm text-ondark">
          <span className="text-stone mr-3">{index}</span>
          {title}
          <span className="text-gain ml-3 text-[13px]">configured</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-mute hover:text-ondark">
          change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[13px] text-stone mb-2 px-2">
        Step {index}
        {!required && ' · optional'}
      </div>
      {children}
    </div>
  );
}
