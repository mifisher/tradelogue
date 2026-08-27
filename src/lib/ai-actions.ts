'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { coachingReviews } from '@/db/schema';
import { aiConfigured, coachModel } from '@/lib/ai/client';
import { generateCoachingReview } from '@/lib/ai/coach';
import { assembleCoachContext } from '@/lib/ai/coach-context-loader';
import {
  getAiConfig,
  invalidApiKeyMessage,
  isAiAuthenticationError,
  isAiRateLimitError,
  missingApiKeyMessage,
} from '@/lib/ai/provider';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap revalidatePath so actions are callable from CLI scripts too. */
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // ignore Next.js context errors (e.g. when called from CLI scripts)
  }
}

function validateDateFormat(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`sessionDate must be in YYYY-MM-DD format, got: ${date}`);
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export type CoachingReviewRow = typeof coachingReviews.$inferSelect;

export async function getCoachingReview(date: string): Promise<CoachingReviewRow | null> {
  const rows = await db
    .select()
    .from(coachingReviews)
    .where(eq(coachingReviews.sessionDate, date));
  return rows[0] ?? null;
}

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) an AI coaching review for the given session date.
 * Upserts the result into coaching_reviews and revalidates the day page.
 */
export async function generateReview(sessionDate: string): Promise<void> {
  validateDateFormat(sessionDate);
  const config = getAiConfig();

  if (!aiConfigured()) {
    throw new Error(missingApiKeyMessage(config));
  }

  try {
    // Assemble context via shared loader (also used by eval harness)
    const context = await assembleCoachContext(sessionDate);

    // Generate the review
    const result = await generateCoachingReview(context);

    // Upsert into coaching_reviews
    await db
      .insert(coachingReviews)
      .values({
        sessionDate,
        whatWorked: result.whatWorked,
        toImprove: result.toImprove,
        patternsToWatch: result.patternsToWatch,
        model: coachModel(),
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: coachingReviews.sessionDate,
        set: {
          whatWorked: result.whatWorked,
          toImprove: result.toImprove,
          patternsToWatch: result.patternsToWatch,
          model: coachModel(),
          generatedAt: new Date(),
        },
      });

    safeRevalidate('/day/' + sessionDate);
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
