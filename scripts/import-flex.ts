import 'dotenv/config';
import { fetchFlexStatement } from '../src/lib/flex-client';
import { importFlexXml } from '../src/lib/import';

async function main() {
  const token = process.env.IBKR_FLEX_TOKEN;
  const queryId = process.env.IBKR_FLEX_QUERY_ID;
  if (!token || !queryId) {
    throw new Error('Set IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID in .env');
  }
  console.log('Requesting Flex statement from IBKR…');
  const xml = await fetchFlexStatement({ token, queryId });
  console.log('Statement received, importing…');
  const result = await importFlexXml(xml, 'flex-api');
  console.log(`Parsed ${result.parsed}, inserted ${result.inserted} new executions, rebuilt ${result.trades} trades.`);
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
