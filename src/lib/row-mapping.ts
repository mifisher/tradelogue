import type { Execution } from './types';
import type { executions } from '@/db/schema';

type ExecutionRow = typeof executions.$inferInsert;
// $inferSelect has `id` and all fields non-optional; accept a wider shape for rowToExecution
type ExecutionSelectRow = typeof executions.$inferSelect;

export function executionToRow(e: Execution): ExecutionRow {
  return {
    execId: e.execId,
    accountId: e.accountId,
    conid: e.conid,
    underlying: e.underlying,
    description: e.description,
    assetCategory: e.assetCategory,
    expiry: e.expiry,
    strike: e.strike,
    putCall: e.putCall,
    multiplier: e.multiplier,
    dateTime: e.dateTime,
    quantity: e.quantity,
    price: e.price,
    proceeds: e.proceeds,
    commission: e.commission,
    raw: e.raw,
  };
}

export function rowToExecution(r: ExecutionRow | ExecutionSelectRow): Execution {
  return {
    execId: r.execId,
    accountId: r.accountId,
    conid: r.conid,
    underlying: r.underlying,
    description: r.description,
    assetCategory: r.assetCategory as 'OPT' | 'STK',
    expiry: r.expiry ?? null,
    strike: r.strike ?? null,
    putCall: (r.putCall as 'P' | 'C') ?? null,
    multiplier: r.multiplier ?? 1,
    dateTime: r.dateTime,
    quantity: r.quantity,
    price: r.price,
    proceeds: r.proceeds,
    commission: r.commission,
    raw: (r.raw ?? {}) as Record<string, unknown>,
  };
}
