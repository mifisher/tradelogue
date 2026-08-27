'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { syncFromIbkr } from '@/lib/sync-actions';

interface SyncButtonProps {
  label?: string;
  className?: string;
}

export function SyncButton({ label = 'Sync from IBKR', className }: SyncButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setStatus(null);
    setError(null);
    startTransition(async () => {
      try {
        const r = await syncFromIbkr();
        setStatus(`Imported ${r.trades} trades · ${r.inserted} new`);
        router.refresh();
        setTimeout(() => setStatus(null), 4000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sync failed');
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={isPending}
        className={
          className ??
          'rounded-full bg-ondark text-canvas px-6 h-10 font-semibold text-sm disabled:opacity-50'
        }
      >
        {isPending ? 'Syncing…' : label}
      </button>
      {status && <p className="text-gain text-sm">{status}</p>}
      {error && <p className="text-loss text-sm">{error}</p>}
    </div>
  );
}
