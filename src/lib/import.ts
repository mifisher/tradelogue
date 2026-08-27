import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { executions, trades, importBatches } from '@/db/schema';
import { parseFlexExecutions } from './flex-parser';
import { buildTrades } from './trade-builder';
import { sessionDate } from './daily-pnl';
import { executionToRow, rowToExecution } from './row-mapping';
import { tradeFingerprint } from './fingerprint';

export interface ImportResult {
  parsed: number;
  inserted: number;
  trades: number;
}

export async function importFlexXml(xml: string, source: 'file' | 'flex-api'): Promise<ImportResult> {
  const parsed = parseFlexExecutions(xml);

  let inserted = 0;
  if (parsed.length > 0) {
    const res = await db
      .insert(executions)
      .values(parsed.map(executionToRow))
      .onConflictDoNothing({ target: executions.execId })
      .returning({ id: executions.id });
    inserted = res.length;
  }

  // Trades are derived data: rebuild from the full execution history every time.
  const allRows = await db.select().from(executions).orderBy(asc(executions.dateTime));
  const built = buildTrades(allRows.map(rowToExecution));

  await db.transaction(async (tx) => {
    await tx.delete(trades);
    if (built.length > 0) {
      await tx.insert(trades).values(
        built.map((t) => ({
          conid: t.conid,
          underlying: t.underlying,
          description: t.description,
          expiry: t.expiry,
          strike: t.strike,
          putCall: t.putCall,
          direction: t.direction,
          status: t.status,
          openedAt: t.openedAt,
          closedAt: t.closedAt,
          sessionDate: t.closedAt ? sessionDate(t.closedAt) : null,
          quantityOpened: t.quantityOpened,
          avgEntryPrice: t.avgEntryPrice,
          avgExitPrice: t.avgExitPrice,
          realizedPnl: t.realizedPnl,
          commissions: t.commissions,
          executionIds: t.executionIds,
          firstExecId: tradeFingerprint(t.executionIds),
        })),
      );
    }
    await tx.insert(importBatches).values({
      source,
      parsedCount: parsed.length,
      insertedCount: inserted,
      tradeCount: built.length,
    });
  });

  return { parsed: parsed.length, inserted, trades: built.length };
}
