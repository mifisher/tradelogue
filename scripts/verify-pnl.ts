import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { sql, eq } from 'drizzle-orm';
import { db } from '../src/db';
import { trades } from '../src/db/schema';

const TOLERANCE = Number(process.env.PNL_TOLERANCE ?? '0.01');

// Your own baseline of known-good per-session P&L. Gitignored, because it is
// real account data — a fresh clone has to supply its own before this runs.
const BASELINE = path.join(__dirname, '../data/expected-daily-pnl.json');

async function main() {
  if (!existsSync(BASELINE)) {
    console.error(
      `No P&L baseline found at ${BASELINE}\n\n` +
        'This script regression-tests the trade-construction engine against P&L\n' +
        'figures you already trust. To create one, write a JSON object mapping\n' +
        'session date to that day\'s realized P&L, taken from your broker statements:\n\n' +
        '  { "2026-06-08": -1250.00, "2026-06-09": 342.15 }\n\n' +
        'It is gitignored on purpose — it is real account data.',
    );
    process.exit(1);
  }

  const expected: Record<string, number> = JSON.parse(readFileSync(BASELINE, 'utf8'));

  const rows = await db
    .select({
      day: trades.sessionDate,
      pnl: sql<number>`round(sum(${trades.realizedPnl})::numeric, 2)::float8`,
    })
    .from(trades)
    .where(eq(trades.status, 'closed'))
    .groupBy(trades.sessionDate);

  const actual = new Map(rows.map((r) => [r.day, r.pnl]));
  const allDays = [...new Set([...Object.keys(expected), ...actual.keys()])].sort();

  let failures = 0;
  console.log('Session      Expected     Actual       Diff       Status');
  console.log('---------------------------------------------------------');
  for (const day of allDays) {
    const exp = expected[day!];
    const act = actual.get(day);
    if (exp === undefined) {
      console.log(`${day}  ${pad('—')} ${pad(act)} ${pad('—')}  EXTRA (not in journal)`);
      continue;
    }
    if (act === undefined) {
      console.log(`${day}  ${pad(exp)} ${pad('—')} ${pad('—')}  MISSING (no imported trades)`);
      failures++;
      continue;
    }
    const diff = Math.round((act - exp) * 100) / 100;
    const ok = Math.abs(diff) <= TOLERANCE;
    if (!ok) failures++;
    console.log(`${day}  ${pad(exp)} ${pad(act)} ${pad(diff)}  ${ok ? 'PASS' : 'FAIL'}`);
  }
  console.log('---------------------------------------------------------');
  console.log(failures === 0 ? 'ALL DAYS MATCH ✅' : `${failures} day(s) off ❌ (journal rounding vs engine bug — investigate each)`);
  process.exit(failures === 0 ? 0 : 1);
}

function pad(v: number | string | undefined): string {
  return String(v ?? '—').padStart(10);
}

main().catch((e) => { console.error(e); process.exit(1); });
