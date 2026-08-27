'use server';

import { revalidatePath } from 'next/cache';
import { desc, ne, eq } from 'drizzle-orm';
import { db } from '@/db';
import { marketBriefs } from '@/db/schema';
import { briefEnvCheck, runBriefPipeline } from '@/lib/market/brief-pipeline';
import type { BriefFreshness } from '@/lib/header-status';

export type MarketBriefRow = typeof marketBriefs.$inferSelect;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // ignore Next.js context errors outside request handling
  }
}

/** Newest usable brief + the error of any newer failed attempt. */
export async function getLatestMarketBrief(): Promise<{
  row: MarketBriefRow | null;
  latestFailure: string | null;
}> {
  const [good] = await db
    .select()
    .from(marketBriefs)
    .where(ne(marketBriefs.status, 'failed'))
    .orderBy(desc(marketBriefs.generatedAt))
    .limit(1);
  const [failed] = await db
    .select()
    .from(marketBriefs)
    .where(eq(marketBriefs.status, 'failed'))
    .orderBy(desc(marketBriefs.generatedAt))
    .limit(1);

  const latestFailure =
    failed && (!good || failed.generatedAt > good.generatedAt) ? failed.error : null;
  return { row: good ?? null, latestFailure };
}

/** Just enough for the header's freshness stamp. Selects three columns rather
 * than the brief jsonb because this runs on every page render, and returns null
 * on any failure — a header ornament must never take a page down with it. */
export async function getBriefFreshness(): Promise<BriefFreshness | null> {
  try {
    const [row] = await db
      .select({
        briefDate: marketBriefs.briefDate,
        generatedAt: marketBriefs.generatedAt,
        status: marketBriefs.status,
      })
      .from(marketBriefs)
      .where(ne(marketBriefs.status, 'failed'))
      .orderBy(desc(marketBriefs.generatedAt))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function getMarketBriefConfig(): Promise<{ configured: boolean; missing: string[] }> {
  return briefEnvCheck();
}

export async function generateMarketBrief(): Promise<void> {
  const result = await runBriefPipeline('manual');
  if (result.status === 'failed') {
    throw new Error(result.error ?? 'Brief generation failed');
  }
  safeRevalidate('/');
  safeRevalidate('/market');
}
