'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { generatePatternAnalysis } from '@/lib/pattern-analysis-actions';
import type { PatternExperiment, PatternInsight } from '@/lib/pattern-analysis';
import { fmtMoney } from '@/lib/format';

export interface PatternAnalysisViewData {
  dateRangeFrom: string;
  dateRangeTo: string;
  sessionsAnalyzed: number;
  tradesAnalyzed: number;
  totalPnl: number;
  summary: string;
  topFocusAreas: PatternInsight[];
  strengthsToLeanInto: PatternInsight[];
  recurringMistakes: PatternInsight[];
  blindSpots: PatternInsight[];
  nextExperiments: PatternExperiment[];
  model: string;
  generatedAt: string;
}

interface PatternAnalysisPanelProps {
  analysis: PatternAnalysisViewData | null;
  enabled: boolean;
  missingMessage: string;
}

const SECTION_LABEL_CLASS = 'text-[13px] uppercase tracking-wide text-stone font-medium';

function InsightCard({ insight }: { insight: PatternInsight }) {
  return (
    <article className="rounded-[12px] border border-hairline bg-deep p-4">
      <h3 className="font-display text-lg text-ondark">{insight.title}</h3>
      <p className="mt-2 text-sm text-mute leading-relaxed">{insight.why}</p>
      <p className="mt-3 text-sm text-ondark leading-relaxed">
        <span className="text-stone">Action: </span>
        {insight.action}
      </p>
      {insight.evidence.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {insight.evidence.map((item, index) => (
            <li key={index} className="flex gap-2 text-[13px] text-stone leading-relaxed">
              <span className="select-none">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function InsightSection({ title, items }: { title: string; items: PatternInsight[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <p className={SECTION_LABEL_CLASS}>{title}</p>
      <div className="mt-3 grid gap-3">
        {items.map((item, index) => (
          <InsightCard key={`${title}-${index}`} insight={item} />
        ))}
      </div>
    </section>
  );
}

function ExperimentsSection({ items }: { items: PatternExperiment[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <p className={SECTION_LABEL_CLASS}>Next experiments</p>
      <div className="mt-3 grid gap-3">
        {items.map((item, index) => (
          <article key={index} className="rounded-[12px] border border-hairline bg-deep p-4">
            <h3 className="font-display text-lg text-ondark">{item.title}</h3>
            <p className="mt-2 text-sm text-mute leading-relaxed">{item.hypothesis}</p>
            <p className="mt-3 text-sm text-ondark leading-relaxed">
              <span className="text-stone">Protocol: </span>
              {item.protocol}
            </p>
            <p className="mt-2 text-sm text-ondark leading-relaxed">
              <span className="text-stone">Success metric: </span>
              {item.successMetric}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PatternAnalysisPanel({
  analysis,
  enabled,
  missingMessage,
}: PatternAnalysisPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  function handleGenerate() {
    setError(null);
    setConfirmation(null);
    startTransition(async () => {
      try {
        await generatePatternAnalysis();
        setConfirmation('Pattern analysis updated.');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not generate pattern analysis');
      }
    });
  }

  return (
    <section className="bg-elevated rounded-[20px] p-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-2xl text-ondark">Pattern analysis</h2>
            <span className="bg-deep rounded-full px-2 py-0.5 text-[11px] text-stone">AI</span>
          </div>
          <p className="mt-2 text-sm text-mute max-w-[720px]">
            Cross-trade coaching from your full journal history: recurring mistakes, strengths,
            blind spots, and the highest-leverage focus areas.
          </p>
        </div>
        {enabled && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isPending}
            className="rounded-full bg-ondark text-canvas px-5 h-10 font-semibold text-sm disabled:opacity-50"
          >
            {isPending ? 'Analyzing…' : analysis ? 'Regenerate' : 'Generate analysis'}
          </button>
        )}
      </div>

      {!enabled && (
        <p className="text-sm text-mute">
          {missingMessage} Restart the dev server after updating{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark text-[13px]">.env</code>.
        </p>
      )}

      {enabled && !analysis && (
        <p className="text-sm text-mute">
          No cross-trade pattern analysis has been generated yet.
        </p>
      )}

      {confirmation && <p className="mb-4 text-sm text-gain">{confirmation}</p>}
      {error && <p className="mb-4 text-sm text-loss">{error}</p>}

      {analysis && (
        <div className="space-y-8">
          <div>
            <p className="text-sm text-ondark leading-relaxed">{analysis.summary}</p>
            <p className="mt-3 text-[12px] text-stone">
              {analysis.dateRangeFrom} → {analysis.dateRangeTo} · {analysis.sessionsAnalyzed}{' '}
              sessions · {analysis.tradesAnalyzed} trades · {fmtMoney(analysis.totalPnl)} ·{' '}
              {analysis.model} · generated {analysis.generatedAt}
            </p>
          </div>

          <InsightSection title="Top focus areas" items={analysis.topFocusAreas} />
          <InsightSection title="Strengths to lean into" items={analysis.strengthsToLeanInto} />
          <InsightSection title="Recurring mistakes" items={analysis.recurringMistakes} />
          <InsightSection title="Blind spots" items={analysis.blindSpots} />
          <ExperimentsSection items={analysis.nextExperiments} />
        </div>
      )}
    </section>
  );
}
