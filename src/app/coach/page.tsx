// ── /coach — Chat with your journal ─────────────────────────────────────────

import { aiConfigured } from '@/lib/ai/client';
import { getAiConfig, missingApiKeyMessage } from '@/lib/ai/provider';
import { CoachChat } from '@/components/coach-chat';
import { Card } from '@/components/card';
import { PAGE_NARROW } from '@/lib/layout';
import {
  PatternAnalysisPanel,
  type PatternAnalysisViewData,
} from '@/components/pattern-analysis-panel';
import { getLatestPatternAnalysis } from '@/lib/pattern-analysis-actions';

export const dynamic = 'force-dynamic';

function formatGeneratedAt(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toPatternAnalysisViewData(
  row: Awaited<ReturnType<typeof getLatestPatternAnalysis>>,
): PatternAnalysisViewData | null {
  if (!row) return null;
  return {
    dateRangeFrom: row.dateRangeFrom,
    dateRangeTo: row.dateRangeTo,
    sessionsAnalyzed: row.sessionsAnalyzed,
    tradesAnalyzed: row.tradesAnalyzed,
    totalPnl: row.totalPnl,
    summary: row.summary,
    topFocusAreas: row.topFocusAreas,
    strengthsToLeanInto: row.strengthsToLeanInto,
    recurringMistakes: row.recurringMistakes,
    blindSpots: row.blindSpots,
    nextExperiments: row.nextExperiments,
    model: row.model,
    generatedAt: formatGeneratedAt(row.generatedAt),
  };
}

export default async function CoachPage() {
  const enabled = aiConfigured();
  const missingMessage = missingApiKeyMessage(getAiConfig());
  const patternAnalysis = toPatternAnalysisViewData(await getLatestPatternAnalysis());

  return (
    <div className={`${PAGE_NARROW} mx-auto px-6 py-12`}>
      <h1 className="font-display text-3xl text-ondark mb-8">Coach</h1>

      <div className="space-y-8">
        <PatternAnalysisPanel
          analysis={patternAnalysis}
          enabled={enabled}
          missingMessage={missingMessage}
        />

      {enabled ? (
        <Card>
          <h2 className="font-display text-xl text-ondark mb-6">Ask your journal</h2>
          <CoachChat />
        </Card>
      ) : (
        <Card>
          <p className="text-mute text-sm">
            {missingMessage} Restart the dev server after updating{' '}
            <code className="bg-deep rounded px-1.5 py-0.5 text-ondark text-[13px]">.env</code>.
          </p>
        </Card>
      )}
      </div>
    </div>
  );
}
