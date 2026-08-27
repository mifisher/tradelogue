import 'dotenv/config';
import { runBriefPipeline, briefEnvCheck } from '../src/lib/market/brief-pipeline';

/**
 * Headless daily market-brief generation — the automated counterpart to the
 * in-app Refresh button. Intended to run under a launchd LaunchAgent at
 * 5:00 AM PT. Safe to run repeatedly: each run inserts a new row and readers
 * take the latest good one.
 */
async function main() {
  const stamp = new Date().toISOString();
  const check = briefEnvCheck();
  if (!check.configured) {
    console.error(`${stamp}  SKIP: market brief not configured (missing ${check.missing.join(', ')})`);
    process.exit(1);
  }
  try {
    const r = await runBriefPipeline('scheduled');
    if (r.status === 'failed') {
      console.error(`${stamp}  FAIL: ${r.error}`);
      process.exit(1);
    }
    console.log(`${stamp}  OK (${r.status}): brief ${r.id} for ${r.briefDate}`);
    process.exit(0);
  } catch (err) {
    console.error(`${stamp}  FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
