import 'dotenv/config';
import { fetchFlexStatement, FlexError } from '../src/lib/flex-client';
import { importFlexXml } from '../src/lib/import';

/**
 * Headless daily IBKR sync — the automated counterpart to the in-app
 * "Sync from IBKR" button. Prefers the intraday Trade Confirmation query,
 * falls back to the end-of-day Activity query. Idempotent (executions dedupe
 * on exec id; trades rebuild from scratch), so running it several times a day
 * is safe. Intended to run under a launchd LaunchAgent.
 */
async function main() {
  const stamp = new Date().toISOString();
  const token = process.env.IBKR_FLEX_TOKEN;
  const queryId =
    process.env.IBKR_TRADE_CONFIRM_QUERY_ID || process.env.IBKR_FLEX_QUERY_ID;
  if (!token || !queryId) {
    console.error(`${stamp}  SKIP: IBKR not configured (set IBKR_FLEX_TOKEN + a query id)`);
    process.exit(1);
  }
  const which = process.env.IBKR_TRADE_CONFIRM_QUERY_ID ? 'trade-confirm' : 'activity';
  try {
    const xml = await fetchFlexStatement({ token, queryId, maxAttempts: 12, delayMs: 5000 });
    const r = await importFlexXml(xml, 'flex-api');
    console.log(
      `${stamp}  OK (${which}): parsed ${r.parsed}, inserted ${r.inserted} new fills, ${r.trades} trades`,
    );
    process.exit(0);
  } catch (err) {
    const msg = err instanceof FlexError ? `not ready: ${err.message}` : String(err);
    console.error(`${stamp}  FAIL (${which}): ${msg}`);
    process.exit(1);
  }
}

main();
