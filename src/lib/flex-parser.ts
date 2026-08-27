import { XMLParser } from 'fast-xml-parser';
import { fromZonedTime } from 'date-fns-tz';
import type { Execution } from './types';
import { TRADING_TIMEZONE } from '@/lib/config';

const TZ_ABBR: Record<string, string> = {
  PST: TRADING_TIMEZONE, PDT: TRADING_TIMEZONE,
  EST: 'America/New_York', EDT: 'America/New_York',
};

interface ParseOptions {
  /** IANA zone the Flex statement timestamps are in (IBKR default: US/Eastern). */
  defaultTimezone?: string;
}

export function parseFlexExecutions(xml: string, opts: ParseOptions = {}): Execution[] {
  const tz = opts.defaultTimezone ?? 'America/New_York';
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
  });
  const doc = parser.parse(xml);
  if (!doc.FlexQueryResponse) throw new Error('Not a Flex Query response');

  const statements = toArray(doc.FlexQueryResponse.FlexStatements?.FlexStatement);
  const out: Execution[] = [];
  for (const st of statements) {
    // Activity Flex uses Trades > Trade; Trade Confirmation Flex uses
    // TradeConfirms > TradeConfirm (and renames several attributes — handled in mapRow).
    const rows = [...toArray(st.Trades?.Trade), ...toArray(st.TradeConfirms?.TradeConfirm)];
    for (const row of rows) {
      if (assetCategoryOf(row) === null) continue; // skip CASH/forex/other
      out.push(mapRow(row, tz));
    }
  }
  return out;
}

/**
 * OPT or STK if this row is a tradeable execution, else null (skip it).
 * Activity rows carry `assetCategory`; Trade Confirmation rows omit it, so we
 * derive it from the contract shape (a put/call ⇒ option, otherwise stock).
 */
function assetCategoryOf(row: Record<string, unknown>): 'OPT' | 'STK' | null {
  const ac = row.assetCategory;
  if (ac === 'OPT' || ac === 'STK') return ac;
  if (ac !== undefined) return null; // explicitly CASH / forex / other
  if (row.putCall === 'P' || row.putCall === 'C') return 'OPT';
  return 'STK';
}

function mapRow(row: Record<string, unknown>, tz: string): Execution {
  const absQty = Math.abs(Number(row.quantity));
  const quantity = row.buySell === 'SELL' ? -absQty : absQty;
  const symbol = String(row.underlyingSymbol || row.symbol);
  return {
    // Activity: ibExecID / ibCommission / tradePrice / description.
    // Trade Confirmation: execID / commission / price / (no description → use symbol).
    execId: String(row.ibExecID ?? row.execID),
    accountId: String(row.accountId),
    conid: Number(row.conid),
    underlying: symbol,
    description: String(row.description ?? row.symbol ?? symbol),
    assetCategory: assetCategoryOf(row) as 'OPT' | 'STK',
    expiry: row.expiry ? isoDate(String(row.expiry)) : null,
    strike: row.strike !== undefined && row.strike !== '' ? Number(row.strike) : null,
    putCall: (row.putCall as 'P' | 'C') || null,
    multiplier: row.multiplier ? Number(row.multiplier) : 1,
    dateTime: parseFlexDateTime(String(row.dateTime), tz),
    quantity,
    price: Number(row.tradePrice ?? row.price),
    proceeds: Number(row.proceeds),
    commission: Number(row.ibCommission ?? row.commission ?? 0),
    raw: row,
  };
}

/** "20260608;063512" (optionally "… PDT") in the statement timezone → UTC Date */
function parseFlexDateTime(value: string, tz: string): Date {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})[;,](\d{2})(\d{2})(\d{2})(?: (\w+))?$/);
  if (!m) throw new Error(`Unrecognized Flex dateTime: ${value}`);
  const [, y, mo, d, h, mi, s, abbr] = m;
  const zone = (abbr && TZ_ABBR[abbr]) || tz;
  return fromZonedTime(`${y}-${mo}-${d}T${h}:${mi}:${s}`, zone);
}

function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
