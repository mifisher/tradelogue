// ── Coaching eval harness ─────────────────────────────────────────────────────
// Selects n sessions with human-written coaching reviews, generates AI reviews,
// judges them against the ground truth, and writes results to eval-results/.
//
// Usage:
//   npm run eval:coaching              # run full eval (needs configured AI provider key)
//   npm run eval:coaching -- --dry-run # select sessions + build contexts only
//   npm run eval:coaching -- 5         # evaluate 5 sessions instead of 10

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { sql, not, isNull } from 'drizzle-orm';
import { db } from '../src/db';
import { sessions } from '../src/db/schema';
import { aiConfigured } from '../src/lib/ai/client';
import { generateCoachingReview } from '../src/lib/ai/coach';
import { assembleCoachContext } from '../src/lib/ai/coach-context-loader';
import { judgeReview, type JudgeOutput } from '../src/lib/ai/judge';
import type { CoachingOutput } from '../src/lib/ai/coach';
import { getAiConfig, missingApiKeyMessage } from '../src/lib/ai/provider';

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const nArg = args.find((a) => /^\d+$/.test(a));
const N = nArg ? parseInt(nArg, 10) : 10;

// ── Session selection ─────────────────────────────────────────────────────────

interface EvalSession {
  sessionDate: string;
  humanReview: string;
}

/**
 * Select n sessions with non-null coaching_review, evenly spaced across the
 * full date range (order by session_date, pick every floor(total/n)th).
 */
async function selectEvalSessions(n: number): Promise<EvalSession[]> {
  // Fetch all sessions with a non-null coaching_review, ordered by date
  const rows = await db
    .select({
      sessionDate: sessions.sessionDate,
      coachingReview: sessions.coachingReview,
    })
    .from(sessions)
    .where(not(isNull(sessions.coachingReview)))
    .orderBy(sql`${sessions.sessionDate} asc`);

  if (rows.length === 0) return [];

  const total = rows.length;
  const step = Math.floor(total / n);

  // Pick every step-th row; always include the last one if n >= total
  const selected: EvalSession[] = [];
  for (let i = 0; i < n && i < total; i++) {
    const idx = Math.min(i * step, total - 1);
    const row = rows[idx];
    selected.push({
      sessionDate: row.sessionDate,
      humanReview: row.coachingReview!,
    });
  }

  // Deduplicate by date (edge case: step=0 when n >= total)
  const seen = new Set<string>();
  const deduped: EvalSession[] = [];
  for (const s of selected) {
    if (!seen.has(s.sessionDate)) {
      seen.add(s.sessionDate);
      deduped.push(s);
    }
  }

  // If deduplication reduced count and we have more sessions, fill from the end
  if (deduped.length < Math.min(n, total)) {
    for (const row of rows) {
      if (deduped.length >= n) break;
      if (!seen.has(row.sessionDate)) {
        seen.add(row.sessionDate);
        deduped.push({ sessionDate: row.sessionDate, humanReview: row.coachingReview! });
      }
    }
  }

  return deduped;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtScore(n: number | undefined): string {
  if (n == null) return '  -';
  return n.toFixed(1).padStart(3);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function aiReviewToText(review: CoachingOutput): string {
  const lines: string[] = [];
  lines.push('What worked:');
  for (const item of review.whatWorked) lines.push(`- ${item}`);
  lines.push('\nWhat to improve:');
  for (const item of review.toImprove) lines.push(`- ${item}`);
  lines.push('\nPatterns to watch:');
  for (const item of review.patternsToWatch) lines.push(`- ${item}`);
  return lines.join('\n');
}

// ── Result types ──────────────────────────────────────────────────────────────

interface SessionResult {
  sessionDate: string;
  contextLength: number;
  aiReview: CoachingOutput | null;
  judgeOutput: JudgeOutput | null;
  error?: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nCoaching eval harness (n=${N}${dryRun ? ', DRY RUN' : ''})`);
  console.log('─'.repeat(60));

  // 1. Select eval sessions
  console.log(`Selecting ${N} sessions with ground-truth reviews...`);
  const evalSessions = await selectEvalSessions(N);

  if (evalSessions.length === 0) {
    console.error('No sessions with coaching_review found — is the journal imported?');
    process.exit(1);
  }

  console.log(`Selected ${evalSessions.length} sessions:`);
  for (const s of evalSessions) {
    console.log(`  ${s.sessionDate}`);
  }
  console.log('');

  // 2. Build contexts for all sessions (always, even in dry run)
  console.log('Building coaching contexts...');
  const contexts = new Map<string, string>();
  for (const s of evalSessions) {
    process.stdout.write(`  ${s.sessionDate}...`);
    const ctx = await assembleCoachContext(s.sessionDate);
    contexts.set(s.sessionDate, ctx);
    process.stdout.write(` ${ctx.length} chars\n`);
  }
  console.log('');

  // 3. If dry run, print summary and exit without any API calls
  if (dryRun) {
    console.log('DRY RUN complete — no API calls made.');
    console.log('Selected dates and context lengths:');
    console.log('─'.repeat(50));
    console.log('Date         Context length');
    console.log('─'.repeat(50));
    for (const s of evalSessions) {
      const len = contexts.get(s.sessionDate)?.length ?? 0;
      console.log(`${s.sessionDate}   ${len.toString().padStart(6)} chars`);
    }
    console.log('─'.repeat(50));
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    process.exit(0);
  }

  // 4. Check API key before making any API calls
  if (!aiConfigured()) {
    console.error(`\n${missingApiKeyMessage(getAiConfig())}`);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    process.exit(1);
  }

  // 5. For each session: generate AI review → judge it (SEQUENTIAL, rate-limit friendly)
  const results: SessionResult[] = [];

  console.log('Running eval (sequential)...');
  console.log('─'.repeat(60));

  for (let i = 0; i < evalSessions.length; i++) {
    const s = evalSessions[i];
    const context = contexts.get(s.sessionDate)!;
    console.log(`[${i + 1}/${evalSessions.length}] ${s.sessionDate} (ctx: ${context.length} chars)`);

    const result: SessionResult = {
      sessionDate: s.sessionDate,
      contextLength: context.length,
      aiReview: null,
      judgeOutput: null,
    };

    try {
      // Generate AI review (side-effect-free — no DB write)
      process.stdout.write('  Generating AI review...');
      result.aiReview = await generateCoachingReview(context);
      process.stdout.write(' done\n');

      // Judge the review
      process.stdout.write('  Judging...');
      result.judgeOutput = await judgeReview({
        context,
        humanReview: s.humanReview,
        aiReview: aiReviewToText(result.aiReview),
      });
      process.stdout.write(' done\n');

      if (result.judgeOutput) {
        const j = result.judgeOutput;
        console.log(
          `  Scores: factual=${j.factualAccuracy} overlap=${j.issueOverlap} rules=${j.ruleGrounding} action=${j.actionability} missed=${j.missedCriticalInsight}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.error = msg;
      console.error(`  ERROR: ${msg}`);
    }

    results.push(result);
    console.log('');
  }

  // 6. Compute summary stats
  const scored = results.filter((r) => r.judgeOutput != null);
  const dims = ['factualAccuracy', 'issueOverlap', 'ruleGrounding', 'actionability'] as const;
  const means: Record<string, number> = {};
  for (const dim of dims) {
    means[dim] = mean(scored.map((r) => r.judgeOutput![dim]));
  }
  const missedCount = scored.filter((r) => r.judgeOutput!.missedCriticalInsight).length;

  // 7. Print results table
  console.log('─'.repeat(80));
  console.log('RESULTS');
  console.log('─'.repeat(80));
  console.log(
    'Date         Factual  Overlap  Rules    Action   Missed?',
  );
  console.log('─'.repeat(80));
  for (const r of results) {
    const j = r.judgeOutput;
    const missed = j ? (j.missedCriticalInsight ? 'YES' : 'no') : '-';
    const errNote = r.error ? ` [ERROR: ${r.error.slice(0, 40)}]` : '';
    console.log(
      `${r.sessionDate}   ${fmtScore(j?.factualAccuracy)}      ${fmtScore(j?.issueOverlap)}      ${fmtScore(j?.ruleGrounding)}      ${fmtScore(j?.actionability)}      ${missed}${errNote}`,
    );
  }
  console.log('─'.repeat(80));
  console.log(
    `MEANS        ${fmtScore(means.factualAccuracy)}      ${fmtScore(means.issueOverlap)}      ${fmtScore(means.ruleGrounding)}      ${fmtScore(means.actionability)}      ${missedCount}/${scored.length} missed`,
  );
  console.log('─'.repeat(80));
  console.log('');

  // 8. Print judge comments for sessions scoring ≤2 anywhere or missing a critical insight
  const flagged = scored.filter(
    (r) =>
      r.judgeOutput!.missedCriticalInsight ||
      dims.some((d) => r.judgeOutput![d] <= 2),
  );

  if (flagged.length > 0) {
    console.log(`FLAGGED SESSIONS (${flagged.length}) — scored ≤2 on any dimension or missed critical insight:`);
    console.log('─'.repeat(80));
    for (const r of flagged) {
      const j = r.judgeOutput!;
      console.log(`${r.sessionDate}: factual=${j.factualAccuracy} overlap=${j.issueOverlap} rules=${j.ruleGrounding} action=${j.actionability} missed=${j.missedCriticalInsight}`);
      console.log(`  Comments: ${j.comments}`);
      console.log('');
    }
  } else {
    console.log('No flagged sessions (all scored >2 and no missed critical insights).');
    console.log('');
  }

  // 9. Write full JSON results
  mkdirSync('eval-results', { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join('eval-results', `coaching-eval-${ts}.json`);
  const outData = {
    runAt: new Date().toISOString(),
    n: N,
    means,
    missedCriticalInsightCount: missedCount,
    scoredCount: scored.length,
    sessions: results.map((r) => ({
      sessionDate: r.sessionDate,
      contextLength: r.contextLength,
      judgeOutput: r.judgeOutput,
      error: r.error ?? null,
    })),
  };
  writeFileSync(outPath, JSON.stringify(outData, null, 2));
  console.log(`Full results written to ${outPath}`);

  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
