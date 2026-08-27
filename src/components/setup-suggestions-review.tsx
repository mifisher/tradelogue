'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createSetupFromSuggestion, dismissSetupSuggestion } from '@/lib/journal-actions';
import type { SetupSuggestionReviewRow } from '@/lib/queries';
import { setupSuggestionConfidenceLabel } from '@/lib/setup-suggestions';
import { fmtMoney } from '@/lib/format';

interface SetupSuggestionsReviewProps {
  initialRows: SetupSuggestionReviewRow[];
}

export function SetupSuggestionsReview({ initialRows }: SetupSuggestionsReviewProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function removeRow(firstExecId: string) {
    setRows((current) => current.filter((item) => item.firstExecId !== firstExecId));
  }

  function handleCreate(row: SetupSuggestionReviewRow) {
    setPendingId(row.firstExecId);
    setError(null);
    setConfirmation(null);
    startTransition(async () => {
      try {
        const result = await createSetupFromSuggestion(
          row.firstExecId,
          row.sessionDate,
          row.setupSuggestion,
        );
        removeRow(row.firstExecId);
        setConfirmation(`Setup ${result.setupNumber} was created and applied to ${row.underlying}.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create setup');
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleDismiss(row: SetupSuggestionReviewRow) {
    setPendingId(row.firstExecId);
    setError(null);
    setConfirmation(null);
    startTransition(async () => {
      try {
        await dismissSetupSuggestion(row.firstExecId, row.sessionDate);
        removeRow(row.firstExecId);
        setConfirmation(`Suggestion dismissed for ${row.underlying}.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not dismiss suggestion');
      } finally {
        setPendingId(null);
      }
    });
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl text-ondark">Suggested setup candidates</h2>
          <p className="mt-1 text-sm text-stone">
            Review unmatched trades from AI fill or rescan, then promote the useful ones into the playbook.
          </p>
        </div>
        <span className="text-[13px] text-stone">{rows.length} pending</span>
      </div>

      <div className="grid gap-4">
        {rows.map((row) => (
          <article key={row.firstExecId} className="rounded-[12px] border border-hairline bg-elevated p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-xl text-ondark">
                    {row.setupSuggestion.name}
                  </h3>
                  <span className="rounded-full bg-deep px-3 py-0.5 text-[12px] text-stone">
                    {setupSuggestionConfidenceLabel(row.setupSuggestion.confidence)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-stone">
                  {row.sessionDate} · {row.underlying} ·{' '}
                  {row.realizedPnl != null ? fmtMoney(row.realizedPnl) : 'P&L unknown'}
                </p>
              </div>
              <Link
                href={`/trade/${encodeURIComponent(row.firstExecId)}`}
                className="text-[13px] text-stone hover:text-ondark transition-colors"
              >
                Open trade
              </Link>
            </div>

            <p className="mt-4 text-sm text-mute leading-relaxed">
              {row.setupSuggestion.description}
            </p>

            <div className="mt-4">
              <p className="text-[13px] uppercase tracking-wide text-stone mb-1">Entry criteria</p>
              <p className="whitespace-pre-wrap text-sm text-mute leading-relaxed">
                {row.setupSuggestion.entryCriteria}
              </p>
            </div>

            <p className="mt-4 text-[13px] text-stone">{row.setupSuggestion.reason}</p>

            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => handleCreate(row)}
                disabled={pendingId === row.firstExecId}
                className="rounded-full bg-ondark text-canvas px-4 h-8 font-semibold text-sm disabled:opacity-50"
              >
                {pendingId === row.firstExecId ? 'Creating…' : 'Create setup + tag trade'}
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(row)}
                disabled={pendingId === row.firstExecId}
                className="rounded-full border border-hairline px-4 h-8 text-sm font-semibold text-stone hover:text-ondark disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </div>

      {confirmation && <p className="mt-3 text-sm text-gain">{confirmation}</p>}
      {error && <p className="mt-3 text-sm text-loss">{error}</p>}
    </section>
  );
}
