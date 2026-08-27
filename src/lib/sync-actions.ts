'use server';
import { revalidatePath } from 'next/cache';
import { fetchFlexStatement, FlexError } from './flex-client';
import { importFlexXml } from './import';

export interface SyncResult { parsed: number; inserted: number; trades: number; }

export async function syncFromIbkr(): Promise<SyncResult> {
  const token = process.env.IBKR_FLEX_TOKEN;
  const queryId = process.env.IBKR_TRADE_CONFIRM_QUERY_ID || process.env.IBKR_FLEX_QUERY_ID;
  if (!token || !queryId) {
    throw new Error('IBKR not configured — set IBKR_FLEX_TOKEN and a query ID in .env');
  }
  let xml: string;
  try {
    // Interactive: poll briefly. Trade-confirmation statements are usually ready at once.
    xml = await fetchFlexStatement({ token, queryId, maxAttempts: 6, delayMs: 3000 });
  } catch (err) {
    // FlexError messages are already written for the trader reading them under
    // the button. Prefixing them produced doubled-up advice — "sync not ready:
    // IBKR is rate-limiting this token … Wait a minute. Try again in a minute."
    if (err instanceof FlexError) throw new Error(err.message);
    throw err;
  }
  const result = await importFlexXml(xml, 'flex-api');
  revalidatePath('/');
  revalidatePath('/calendar');
  return result;
}
