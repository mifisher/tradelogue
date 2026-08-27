'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  rescanUntaggedTradesForSetups,
  type SetupRescanResult,
} from '@/lib/setup-rescan-actions';

function resultText(result: SetupRescanResult): string {
  return [
    `${result.scanned} scanned`,
    `${result.tagged} tagged`,
    `${result.suggested} suggestions`,
    `${result.skippedNoNotes} skipped`,
    result.failed > 0 ? `${result.failed} failed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function SetupRescanButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SetupRescanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRescan() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await rescanUntaggedTradesForSetups());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not rescan setups');
      }
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={handleRescan}
        disabled={isPending}
        className="rounded-full bg-ondark text-canvas px-4 h-9 font-semibold text-sm disabled:opacity-50"
      >
        {isPending ? 'Rescanning…' : 'Rescan untagged trades'}
      </button>
      {result && (
        <span className="text-[13px] text-stone">
          {resultText(result)}
        </span>
      )}
      {error && <span className="text-[13px] text-loss">{error}</span>}
    </div>
  );
}
