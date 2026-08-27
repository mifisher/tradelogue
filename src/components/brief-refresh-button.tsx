'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateMarketBrief } from '@/lib/market-brief-actions';

interface BriefRefreshButtonProps {
  label?: string;
  className?: string;
  compact?: boolean;
}

/** Sized to sit with the 11px timestamp beside it — an unsized <svg> falls back
 * to the browser's 300x150 default and bursts out of the button. */
const GLYPH_SIZE = 'h-3.5 w-3.5';

function RefreshGlyph({ state }: { state: 'idle' | 'pending' | 'success' }) {
  if (state === 'success') {
    return (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={GLYPH_SIZE} aria-hidden>
        <path d="m4 10 3.5 3.5L16 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`${GLYPH_SIZE} ${state === 'pending' ? 'animate-spin' : ''}`}
      aria-hidden
    >
      <path d="M16 8a6.5 6.5 0 1 0 1 4" strokeLinecap="round" />
      <path d="M16 3.5V8h-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BriefRefreshButton({ label = 'Refresh brief', className, compact = false }: BriefRefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  function handleClick() {
    setError(null);
    setSucceeded(false);
    startTransition(async () => {
      try {
        await generateMarketBrief();
        setSucceeded(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Brief generation failed');
      }
    });
  }

  const state = isPending ? 'pending' : succeeded ? 'success' : 'idle';
  const buttonLabel = state === 'pending'
    ? 'Generating market brief'
    : state === 'success'
      ? 'Market brief updated'
      : 'Refresh market brief';

  return (
    <div className={compact ? 'relative shrink-0' : 'flex flex-col gap-1'}>
      <button
        onClick={handleClick}
        disabled={isPending}
        aria-label={compact ? buttonLabel : undefined}
        title={compact ? buttonLabel : undefined}
        className={
          className ??
          (compact
            ? 'grid h-5 w-5 place-items-center rounded text-mute transition-colors hover:text-ondark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:opacity-50'
            : 'rounded-full bg-ondark text-canvas px-6 h-10 font-semibold text-sm disabled:opacity-50')
        }
      >
        {compact ? (
          <RefreshGlyph state={state} />
        ) : isPending ? 'Generating… (takes a minute)' : succeeded ? 'Updated' : label}
      </button>
      {succeeded && <p role="status" className={compact ? 'sr-only' : 'text-gain text-sm'}>Brief updated.</p>}
      {error && (
        <p
          role="alert"
          className={compact ? 'absolute right-0 top-full z-10 mt-2 w-64 rounded bg-elevated px-3 py-2 text-xs text-loss shadow-lg' : 'text-loss text-sm'}
        >
          {error}
        </p>
      )}
    </div>
  );
}
