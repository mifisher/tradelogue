'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { patternAnalyses } from '@/db/schema';
import { aiConfigured, coachModel } from '@/lib/ai/client';
import { generatePatternAnalysisReview } from '@/lib/ai/pattern-analysis';
import { assemblePatternAnalysisContext } from '@/lib/pattern-analysis-context-loader';
import {
  getAiConfig,
  invalidApiKeyMessage,
  isAiAuthenticationError,
  isAiRateLimitError,
  missingApiKeyMessage,
} from '@/lib/ai/provider';

export type PatternAnalysisRow = typeof patternAnalyses.$inferSelect;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // ignore Next.js context errors outside request handling
  }
}

export async function getLatestPatternAnalysis(): Promise<PatternAnalysisRow | null> {
  const rows = await db
    .select()
    .from(patternAnalyses)
    .where(eq(patternAnalyses.scope, 'all-time'))
    .orderBy(desc(patternAnalyses.generatedAt))
    .limit(1);

  return rows[0] ?? null;
}

export async function generatePatternAnalysis(): Promise<void> {
  const config = getAiConfig();
  if (!aiConfigured()) {
    throw new Error(missingApiKeyMessage(config));
  }

  try {
    const { context, meta } = await assemblePatternAnalysisContext();
    const result = await generatePatternAnalysisReview(context);
    const generatedAt = new Date();

    await db
      .insert(patternAnalyses)
      .values({
        scope: 'all-time',
        dateRangeFrom: meta.from,
        dateRangeTo: meta.to,
        sessionsAnalyzed: meta.sessions,
        tradesAnalyzed: meta.trades,
        totalPnl: meta.totalPnl,
        summary: result.summary,
        topFocusAreas: result.topFocusAreas,
        strengthsToLeanInto: result.strengthsToLeanInto,
        recurringMistakes: result.recurringMistakes,
        blindSpots: result.blindSpots,
        nextExperiments: result.nextExperiments,
        model: coachModel(),
        generatedAt,
      })
      .onConflictDoUpdate({
        target: patternAnalyses.scope,
        set: {
          dateRangeFrom: meta.from,
          dateRangeTo: meta.to,
          sessionsAnalyzed: meta.sessions,
          tradesAnalyzed: meta.trades,
          totalPnl: meta.totalPnl,
          summary: result.summary,
          topFocusAreas: result.topFocusAreas,
          strengthsToLeanInto: result.strengthsToLeanInto,
          recurringMistakes: result.recurringMistakes,
          blindSpots: result.blindSpots,
          nextExperiments: result.nextExperiments,
          model: coachModel(),
          generatedAt,
        },
      });

    safeRevalidate('/coach');
    safeRevalidate('/');
  } catch (err) {
    if (isAiAuthenticationError(err)) {
      throw new Error(invalidApiKeyMessage(config));
    }
    if (isAiRateLimitError(err)) {
      throw new Error('Rate limited by the API — try again in a minute');
    }
    throw err;
  }
}
