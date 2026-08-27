'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { tradeAnnotations, trades } from '@/db/schema';
import { getSetups } from '@/lib/queries';
import { synthesizeTradeNotes } from '@/lib/ai/voice-synthesis';
import { buildSetupSuggestion } from '@/lib/setup-suggestions';
import { buildRescanTranscript, shouldScanUntaggedTrade } from '@/lib/setup-rescan';
import {
  getAiConfig,
  invalidApiKeyMessage,
  isAiAuthenticationError,
  isAiConfigured,
  isAiRateLimitError,
  missingApiKeyMessage,
} from '@/lib/ai/provider';

const RESCAN_CONCURRENCY = 4;

export interface SetupRescanResult {
  candidates: number;
  scanned: number;
  tagged: number;
  suggested: number;
  skippedNoNotes: number;
  failed: number;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // ignore Next.js context errors outside request handling
  }
}

export async function rescanUntaggedTradesForSetups(): Promise<SetupRescanResult> {
  const config = getAiConfig();
  if (!isAiConfigured(config)) {
    throw new Error(missingApiKeyMessage(config));
  }

  const setupRows = await getSetups();
  const setupContext = setupRows.map((s) => ({
    number: s.number,
    name: s.name,
    description: s.description,
    entryCriteria: s.entryCriteria,
    idealConditions: s.idealConditions,
  }));

  const rows = await db
    .select({ trade: trades, annotation: tradeAnnotations })
    .from(trades)
    .leftJoin(tradeAnnotations, eq(trades.firstExecId, tradeAnnotations.firstExecId))
    .where(and(eq(trades.status, 'closed'), isNull(tradeAnnotations.setupNumber)))
    .orderBy(desc(trades.openedAt));

  const result: SetupRescanResult = {
    candidates: rows.length,
    scanned: 0,
    tagged: 0,
    suggested: 0,
    skippedNoNotes: 0,
    failed: 0,
  };

  async function processRow({ trade, annotation }: (typeof rows)[number]) {
    if (!trade.firstExecId || !trade.sessionDate) {
      result.skippedNoNotes++;
      return;
    }

    const eligibility = {
      setupNumber: annotation?.setupNumber ?? null,
      thesis: annotation?.thesis ?? null,
      executionNotes: annotation?.executionNotes ?? null,
    };
    if (!shouldScanUntaggedTrade(eligibility)) {
      result.skippedNoNotes++;
      return;
    }

    try {
      result.scanned++;
      const out = await synthesizeTradeNotes(
        setupContext,
        {
          underlying: trade.underlying,
          direction: trade.direction,
          pnl: trade.realizedPnl ?? 0,
        },
        buildRescanTranscript(eligibility),
      );

      const setupNumber =
        (out.setupMatchConfidence === 'high' || out.setupMatchConfidence === 'medium') &&
        out.setupNumber != null &&
        setupRows.some((s) => s.number === out.setupNumber)
          ? out.setupNumber
          : null;
      const setupSuggestion = buildSetupSuggestion(out);

      await db
        .insert(tradeAnnotations)
        .values({
          firstExecId: trade.firstExecId,
          setupNumber,
          setupSuggestion,
        })
        .onConflictDoUpdate({
          target: tradeAnnotations.firstExecId,
          set: {
            setupNumber,
            setupSuggestion,
            updatedAt: new Date(),
          },
        });

      if (setupNumber != null) result.tagged++;
      if (setupSuggestion != null) result.suggested++;

      safeRevalidate('/trade/' + trade.firstExecId);
      safeRevalidate('/day/' + trade.sessionDate);
    } catch (err) {
      if (isAiAuthenticationError(err)) {
        throw new Error(invalidApiKeyMessage(config));
      }
      if (isAiRateLimitError(err)) {
        throw new Error('Rate limited by the API — try again in a minute');
      }
      result.failed++;
    }
  }

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(RESCAN_CONCURRENCY, rows.length) }, async () => {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex++];
      await processRow(row);
    }
  });
  await Promise.all(workers);

  safeRevalidate('/setups');
  return result;
}
