import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attachments, sessions, setups, tradeAnnotations, trades } from '@/db/schema';
import type { StatTrade } from './stats';
import { isNull, not } from 'drizzle-orm';

export interface TradeFilters {
  from?: string;        // sessionDate inclusive
  to?: string;
  underlying?: string;
  direction?: 'long' | 'short';
  result?: 'win' | 'loss';
}

export type TradeRow = typeof trades.$inferSelect;

export async function closedTrades(filters: TradeFilters = {}): Promise<TradeRow[]> {
  const conds = [eq(trades.status, 'closed')];
  if (filters.from) conds.push(gte(trades.sessionDate, filters.from));
  if (filters.to) conds.push(lte(trades.sessionDate, filters.to));
  if (filters.underlying) conds.push(eq(trades.underlying, filters.underlying));
  if (filters.direction) conds.push(eq(trades.direction, filters.direction));
  if (filters.result === 'win') conds.push(sql`${trades.realizedPnl} > 0`);
  if (filters.result === 'loss') conds.push(sql`${trades.realizedPnl} <= 0`);
  return db.select().from(trades).where(and(...conds)).orderBy(desc(trades.openedAt));
}

export function toStatTrade(r: TradeRow): StatTrade {
  return {
    underlying: r.underlying,
    direction: r.direction as 'long' | 'short',
    openedAt: r.openedAt,
    closedAt: r.closedAt!,
    sessionDate: r.sessionDate!,
    quantityOpened: r.quantityOpened,
    realizedPnl: r.realizedPnl!,
  };
}

export interface DailySummary { day: string; pnl: number; tradeCount: number; }

export async function dailySummaries(): Promise<DailySummary[]> {
  const rows = await db
    .select({
      day: trades.sessionDate,
      pnl: sql<number>`round(sum(${trades.realizedPnl})::numeric, 2)::float8`,
      tradeCount: sql<number>`count(*)::int`,
    })
    .from(trades)
    .where(eq(trades.status, 'closed'))
    .groupBy(trades.sessionDate)
    .orderBy(asc(trades.sessionDate));
  return rows.filter((r): r is DailySummary => r.day !== null);
}

export async function underlyings(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ u: trades.underlying })
    .from(trades)
    .where(eq(trades.status, 'closed'))
    .orderBy(asc(trades.underlying));
  return rows.map((r) => r.u);
}

// ── Journal queries ────────────────────────────────────────────────────────

export type SessionRow = typeof sessions.$inferSelect;
export type AnnotationRow = typeof tradeAnnotations.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type SetupRow = typeof setups.$inferSelect;

/** Fetch the session row for a given YYYY-MM-DD date, or null if none. */
export async function getSession(date: string): Promise<SessionRow | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionDate, date));
  return rows[0] ?? null;
}

/** Fetch annotations for the given firstExecIds and return as a Map keyed by firstExecId.
 *  Empty input → empty Map (no DB round-trip). */
export async function getAnnotationsByExecIds(
  execIds: string[],
): Promise<Map<string, AnnotationRow>> {
  if (execIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(tradeAnnotations)
    .where(inArray(tradeAnnotations.firstExecId, execIds));
  return new Map(rows.map((r) => [r.firstExecId, r]));
}

/** Fetch session-level attachments for a given date (those not tied to a specific
 *  trade), ordered by creation time. Trade-level shots live on the trade detail page. */
export async function getAttachments(date: string): Promise<AttachmentRow[]> {
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.sessionDate, date), isNull(attachments.firstExecId)))
    .orderBy(asc(attachments.createdAt));
}

/** Fetch attachments tied to a specific trade (by firstExecId), ordered by creation time. */
export async function getAttachmentsByExecId(execId: string): Promise<AttachmentRow[]> {
  if (!execId) return [];
  return db
    .select()
    .from(attachments)
    .where(eq(attachments.firstExecId, execId))
    .orderBy(asc(attachments.createdAt));
}

/** Fetch all setups ordered by number. */
export async function getSetups(): Promise<SetupRow[]> {
  return db.select().from(setups).orderBy(asc(setups.number));
}

/** Return a Map from YYYY-MM-DD session date → sentiment string (or null) for all journaled sessions. */
export async function sentimentByDate(): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ sessionDate: sessions.sessionDate, sentiment: sessions.sentiment })
    .from(sessions);
  return new Map(rows.map((r) => [r.sessionDate, r.sentiment ?? null]));
}

/** Return the set of YYYY-MM-DD dates that have a sessions row (for calendar badges). */
export async function journaledDates(): Promise<Set<string>> {
  const rows = await db
    .select({ sessionDate: sessions.sessionDate })
    .from(sessions);
  return new Set(rows.map((r) => r.sessionDate));
}

/**
 * Sorted union of all dates that appear in either closed trades OR sessions.
 * Used for prev/next navigation so journaled-only days (no trades) are navigable.
 */
export async function navDates(): Promise<string[]> {
  const [tradeRows, sessionRows] = await Promise.all([
    db
      .selectDistinct({ d: trades.sessionDate })
      .from(trades)
      .where(eq(trades.status, 'closed')),
    db
      .selectDistinct({ d: sessions.sessionDate })
      .from(sessions),
  ]);
  const set = new Set<string>();
  for (const r of tradeRows) if (r.d) set.add(r.d);
  for (const r of sessionRows) set.add(r.d);
  return [...set].sort();
}

/** Fetch a single setup by its number (1-based), or null if not found. */
export async function getSetup(number: number): Promise<SetupRow | null> {
  const rows = await db
    .select()
    .from(setups)
    .where(eq(setups.number, number));
  return rows[0] ?? null;
}

/**
 * Single joined query: trades ↔ tradeAnnotations by firstExecId, grouped in JS.
 * Returns a Map from setupNumber → TradeRow[].
 * Only closed trades with a non-null setupNumber annotation are included.
 */
export async function tradesForAllSetups(): Promise<Map<number, TradeRow[]>> {
  const rows = await db
    .select({ trade: trades, setupNumber: tradeAnnotations.setupNumber })
    .from(tradeAnnotations)
    .innerJoin(trades, eq(trades.firstExecId, tradeAnnotations.firstExecId))
    .where(
      and(
        eq(trades.status, 'closed'),
        not(isNull(tradeAnnotations.setupNumber)),
      ),
    )
    .orderBy(desc(trades.openedAt));

  const result = new Map<number, TradeRow[]>();
  for (const { trade, setupNumber } of rows) {
    if (setupNumber === null) continue;
    if (!result.has(setupNumber)) result.set(setupNumber, []);
    result.get(setupNumber)!.push(trade);
  }
  return result;
}

/**
 * Fetch closed trades tagged with a given setupNumber, ordered newest first.
 */
export async function tradesBySetup(setupNumber: number): Promise<TradeRow[]> {
  const rows = await db
    .select({ trade: trades })
    .from(tradeAnnotations)
    .innerJoin(trades, eq(trades.firstExecId, tradeAnnotations.firstExecId))
    .where(
      and(
        eq(trades.status, 'closed'),
        eq(tradeAnnotations.setupNumber, setupNumber),
      ),
    )
    .orderBy(desc(trades.openedAt));
  return rows.map((r) => r.trade);
}

export interface TradeDetail {
  trade: TradeRow;
  annotation: AnnotationRow | null;
}

export interface SetupSuggestionReviewRow {
  firstExecId: string;
  sessionDate: string;
  underlying: string;
  realizedPnl: number | null;
  setupSuggestion: NonNullable<AnnotationRow['setupSuggestion']>;
}

export async function getSetupSuggestions(): Promise<SetupSuggestionReviewRow[]> {
  const rows = await db
    .select({
      firstExecId: tradeAnnotations.firstExecId,
      sessionDate: trades.sessionDate,
      underlying: trades.underlying,
      realizedPnl: trades.realizedPnl,
      setupSuggestion: tradeAnnotations.setupSuggestion,
      openedAt: trades.openedAt,
    })
    .from(tradeAnnotations)
    .innerJoin(trades, eq(trades.firstExecId, tradeAnnotations.firstExecId))
    .where(not(isNull(tradeAnnotations.setupSuggestion)))
    .orderBy(desc(trades.openedAt));

  return rows
    .filter(
      (row): row is typeof row & {
        sessionDate: string;
        setupSuggestion: NonNullable<AnnotationRow['setupSuggestion']>;
      } => row.sessionDate !== null && row.setupSuggestion !== null,
    )
    .map(({ firstExecId, sessionDate, underlying, realizedPnl, setupSuggestion }) => ({
      firstExecId,
      sessionDate,
      underlying,
      realizedPnl,
      setupSuggestion,
    }));
}

/** Fetch a single closed trade by its firstExecId, with its annotation (or null).
 *  Returns null when no closed trade matches. */
export async function getTradeByExecId(execId: string): Promise<TradeDetail | null> {
  if (!execId) return null;
  const tradeRows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.firstExecId, execId), eq(trades.status, 'closed')));
  const trade = tradeRows[0];
  if (!trade) return null;

  const annRows = await db
    .select()
    .from(tradeAnnotations)
    .where(eq(tradeAnnotations.firstExecId, execId));

  return { trade, annotation: annRows[0] ?? null };
}
