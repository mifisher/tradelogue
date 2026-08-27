'use client';

import { useTransition, useState } from 'react';
import { generateReview } from '@/lib/ai-actions';

interface ReviewData {
  whatWorked: string[];
  toImprove: string[];
  patternsToWatch: string[];
  model: string;
  generatedAt: string; // pre-formatted string (serializable)
}

interface AiCoachingProps {
  sessionDate: string;
  review: ReviewData | null;
  /** When false, hide the Generate button and show a muted placeholder. */
  hasTrades?: boolean;
}

function AiBadge() {
  return (
    <span className="bg-deep rounded-full px-2 py-0.5 text-[11px] text-stone ml-2 align-middle">
      AI
    </span>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-stone select-none mt-px">•</span>
          <span className="text-sm text-ondark/90 leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const SECTION_LABEL_CLASS = 'text-[13px] uppercase tracking-wide text-stone font-medium';

export function AiCoaching({ sessionDate, review: initialReview, hasTrades = true }: AiCoachingProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localReview] = useState<ReviewData | null>(initialReview);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      try {
        await generateReview(sessionDate);
        // After server action succeeds, Next.js revalidates — but since this is
        // a client component we can't re-fetch automatically without a router
        // refresh. We rely on the page revalidation; show a success hint.
        // A full router.refresh() would work here too, but keep it simple.
        // The user will see the new review after a page reload or next nav.
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'An unexpected error occurred');
      }
    });
  }

  const hasReview = localReview !== null;

  return (
    <section className="bg-elevated rounded-[20px] p-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center">
          <h2 className="font-display text-xl text-ondark">
            AI coaching
            <AiBadge />
          </h2>
        </div>
        {hasReview && (
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="bg-elevated border border-hairline text-ondark text-sm rounded-full px-4 py-1.5 transition-opacity hover:opacity-70 disabled:opacity-40 cursor-pointer"
          >
            {isPending ? 'Coaching…' : 'Regenerate'}
          </button>
        )}
      </div>

      {/* Error display */}
      {error && (
        <p className="text-loss text-sm mb-4">{error}</p>
      )}

      {/* No review state */}
      {!hasReview && (
        <div className="flex flex-col items-start gap-4">
          {hasTrades ? (
            <>
              <p className="text-sm text-mute">
                No AI coaching review for this session yet.
              </p>
              <button
                onClick={handleGenerate}
                disabled={isPending}
                className="bg-ondark text-deep text-sm font-medium rounded-full px-5 py-2 transition-opacity hover:opacity-80 disabled:opacity-40 cursor-pointer"
              >
                {isPending ? 'Coaching…' : 'Generate review'}
              </button>
            </>
          ) : (
            <p className="text-sm text-mute">
              Available once trades are synced.
            </p>
          )}
        </div>
      )}

      {/* Review content */}
      {hasReview && (
        <div className="space-y-6">
          {/* What worked */}
          <div>
            <p className={SECTION_LABEL_CLASS}>What worked</p>
            <BulletList items={localReview.whatWorked} />
          </div>

          {/* What to improve */}
          <div>
            <p className={SECTION_LABEL_CLASS}>What to improve</p>
            <BulletList items={localReview.toImprove} />
          </div>

          {/* Patterns to watch */}
          <div>
            <p className={SECTION_LABEL_CLASS}>Patterns to watch</p>
            <BulletList items={localReview.patternsToWatch} />
          </div>

          {/* Footer */}
          <p className="text-[12px] text-stone mt-2">
            {localReview.model} · generated {localReview.generatedAt}
          </p>
        </div>
      )}
    </section>
  );
}
