import 'dotenv/config';
import { fetchFlexStatement } from '../src/lib/flex-client';
import { importFlexXml } from '../src/lib/import';

// One-shot recovery tool for stuck IBKR statement generation (e.g. nightly
// maintenance window): retries the full SendRequest+poll cycle for up to an hour.
async function main() {
  const token = process.env.IBKR_FLEX_TOKEN;
  const queryId = process.env.IBKR_FLEX_QUERY_ID;
  if (!token || !queryId) throw new Error('Set IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID in .env');

  const cycles = Number(process.env.POLL_CYCLES ?? '12');
  const cycleDelayMs = Number(process.env.POLL_CYCLE_DELAY_MS ?? '300000');

  for (let cycle = 1; cycle <= cycles; cycle++) {
    console.log(`[cycle ${cycle}/${cycles}] requesting statement…`);
    try {
      const xml = await fetchFlexStatement({ token, queryId, maxAttempts: 12, delayMs: 5000 });
      console.log(`Statement received (${xml.length} bytes), importing…`);
      const result = await importFlexXml(xml, 'flex-api');
      console.log(`IMPORT OK: parsed ${result.parsed}, inserted ${result.inserted}, trades ${result.trades}`);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('not ready')) throw e;
      console.log(`[cycle ${cycle}] still generating; sleeping ${Math.round(cycleDelayMs / 60000)} min`);
      if (cycle < cycles) await new Promise((r) => setTimeout(r, cycleDelayMs));
    }
  }
  throw new Error(`Statement never completed after ${cycles} cycles`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
