/**
 * import-journal.ts
 *
 * Imports all YYYY-MM-DD.md journal entries from a markdown journal folder
 * into your Tradelogue database. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/import-journal.ts <journalDir>
 *   npm run import:journal -- "/path/to/wiki/Trading Journal"
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db } from '../src/db';
import { sessions, tradeAnnotations, attachments, trades } from '../src/db/schema';
import { parseJournalEntry, ParsedTrade } from '../src/lib/journal-parser';
import { findComboMatch } from '../src/lib/trade-matcher';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// CLI arg
// ---------------------------------------------------------------------------

const journalDir = process.argv[2];
if (!journalDir) {
  console.error('Usage: npx tsx scripts/import-journal.ts <journalDir>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Counters for the final report
// ---------------------------------------------------------------------------

let sessionsUpserted = 0;
let tradesMatched = 0;
let tradesComboMatchedJournal = 0;   // number of journal trades resolved via combo pass
let tradesComboMatchedDb = 0;        // total DB trades annotated via combo pass
let tradesUnmatched = 0;
const unmatchedDetails: { date: string; ticker: string; pnl: number | null; reason: string }[] = [];
let imagesCopied = 0;
let imagesSkipped = 0;
let imagesMissing = 0;

// ---------------------------------------------------------------------------
// DB trade type (what we fetch)
// ---------------------------------------------------------------------------

interface DbTrade {
  firstExecId: string;
  sessionDate: string;
  underlying: string;
  putCall: string | null;
  realizedPnl: number | null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Collect all YYYY-MM-DD.md files
  const allFiles = fs.readdirSync(journalDir);
  const dateFiles = allFiles
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();

  console.log(`Found ${dateFiles.length} journal entries in ${journalDir}`);

  // 2. Load all DB trades (for matching) — fetch once, group by sessionDate
  const allDbTrades = await db
    .select({
      firstExecId: trades.firstExecId,
      sessionDate: trades.sessionDate,
      underlying: trades.underlying,
      putCall: trades.putCall,
      realizedPnl: trades.realizedPnl,
    })
    .from(trades);

  const dbTradesBySession = new Map<string, DbTrade[]>();
  for (const t of allDbTrades) {
    if (!t.sessionDate || !t.firstExecId) continue;
    const list = dbTradesBySession.get(t.sessionDate) ?? [];
    list.push({
      firstExecId: t.firstExecId,
      sessionDate: t.sessionDate,
      underlying: t.underlying,
      putCall: t.putCall,
      realizedPnl: t.realizedPnl ?? null,
    });
    dbTradesBySession.set(t.sessionDate, list);
  }

  // 3. Ensure uploads/ directory exists
  const uploadsDir = path.join(path.dirname(__dirname), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  // 4. Process each journal entry
  for (const fileName of dateFiles) {
    const sessionDate = fileName.replace('.md', '');
    const filePath = path.join(journalDir, fileName);
    const markdown = fs.readFileSync(filePath, 'utf8');

    const entry = parseJournalEntry(markdown, sessionDate);

    // ---- Upsert session ----
    await db
      .insert(sessions)
      .values({
        sessionDate: entry.sessionDate,
        sentiment: entry.sentiment,
        mood: entry.mood,
        sleepScore: entry.sleepScore,
        sleepMinutes: entry.sleepMinutes,
        marketContext: entry.marketContext,
        recap: entry.recap,
        journalPnl: entry.journalPnl,
        coachingReview: entry.coachingReview,
      })
      .onConflictDoUpdate({
        target: sessions.sessionDate,
        set: {
          sentiment: entry.sentiment,
          mood: entry.mood,
          sleepScore: entry.sleepScore,
          sleepMinutes: entry.sleepMinutes,
          marketContext: entry.marketContext,
          recap: entry.recap,
          journalPnl: entry.journalPnl,
          coachingReview: entry.coachingReview,
          updatedAt: sql`now()`,
        },
      });
    sessionsUpserted++;

    // ---- Match journal trades → DB trades ----
    const sessionDbTrades = dbTradesBySession.get(sessionDate) ?? [];
    // Track which DB trades have been used (by firstExecId) — each used at most once
    const usedFirstExecIds = new Set<string>();
    // Collect journal trades that failed the primary pass for the combo pass
    const pendingCombo: ParsedTrade[] = [];

    for (const jt of entry.trades) {
      const matched = await matchAndAnnotate(jt, sessionDate, sessionDbTrades, usedFirstExecIds);
      if (!matched) {
        pendingCombo.push(jt);
      }
    }

    // ---- Second pass: combo matching for ×N trades ----
    for (const jt of pendingCombo) {
      await comboMatchAndAnnotate(jt, sessionDate, sessionDbTrades, usedFirstExecIds);
    }

    // ---- Copy images ----
    for (const imgName of entry.sessionImages) {
      await copyImage(imgName, sessionDate, journalDir, uploadsDir);
    }
  }

  // 5. Print report
  console.log('\n========== Import Report ==========');
  console.log(`Sessions upserted:    ${sessionsUpserted}`);
  console.log(`Trades matched:       ${tradesMatched}`);
  console.log(`Combo-matched:        ${tradesComboMatchedJournal} journal entries → ${tradesComboMatchedDb} DB trades`);
  console.log(`Trades unmatched:     ${tradesUnmatched}`);
  if (unmatchedDetails.length > 0) {
    console.log('\nUnmatched trades:');
    for (const u of unmatchedDetails) {
      const pnlStr = u.pnl != null ? `$${u.pnl}` : 'no pnl';
      console.log(`  ${u.date}  ${u.ticker.padEnd(6)} ${pnlStr.padStart(10)}  → ${u.reason}`);
    }
  }
  console.log(`\nImages copied:        ${imagesCopied}`);
  console.log(`Images skipped:       ${imagesSkipped} (already in uploads/)`);
  console.log(`Images missing:       ${imagesMissing} (source not found in Media/)`);
  console.log('===================================');

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Upsert a single trade annotation
// ---------------------------------------------------------------------------

async function upsertAnnotation(firstExecId: string, jt: ParsedTrade): Promise<void> {
  await db
    .insert(tradeAnnotations)
    .values({
      firstExecId,
      setupNumber: jt.setupNumber,
      thesis: jt.thesis,
      executionNotes: jt.executionNotes,
      grade: jt.grade,
    })
    .onConflictDoUpdate({
      target: tradeAnnotations.firstExecId,
      set: {
        setupNumber: jt.setupNumber,
        thesis: jt.thesis,
        executionNotes: jt.executionNotes,
        grade: jt.grade,
        updatedAt: sql`now()`,
      },
    });
}

// ---------------------------------------------------------------------------
// Primary pass: Match a journal trade 1:1 to a DB trade and upsert annotation.
// Returns true if a match was made (and annotation upserted), false otherwise.
// Unmatched trades that could be ×N combos do NOT push to unmatchedDetails here —
// the caller will feed them to the combo pass, which decides final fate.
// ---------------------------------------------------------------------------

async function matchAndAnnotate(
  jt: ParsedTrade,
  sessionDate: string,
  sessionDbTrades: DbTrade[],
  usedFirstExecIds: Set<string>,
): Promise<boolean> {
  // Filter candidates: same underlying + (putCall match if journal has putCall)
  const candidates = sessionDbTrades.filter((t) => {
    if (t.underlying !== jt.underlying) return false;
    if (jt.putCall !== null && t.putCall !== jt.putCall) return false;
    if (usedFirstExecIds.has(t.firstExecId)) return false;
    return true;
  });

  if (candidates.length === 0) {
    tradesUnmatched++;
    unmatchedDetails.push({
      date: sessionDate,
      ticker: jt.underlying,
      pnl: jt.pnl,
      reason: jt.putCall
        ? `no DB trade for ${jt.underlying} ${jt.putCall} on ${sessionDate}`
        : `no DB trade for ${jt.underlying} on ${sessionDate}`,
    });
    return false;
  }

  // Try to find best match by pnl delta
  let bestMatch: DbTrade | null = null;

  // Determine which PnL to use for matching: prefer header pnl, fallback to outcomePnlHint
  const matchPnl = jt.pnl ?? jt.outcomePnlHint;

  if (matchPnl !== null) {
    // Sort candidates by |pnl delta|
    const withDelta = candidates.map((t) => ({
      trade: t,
      delta: Math.abs((t.realizedPnl ?? 0) - matchPnl),
    }));
    withDelta.sort((a, b) => a.delta - b.delta);

    if (withDelta[0].delta <= 25) {
      bestMatch = withDelta[0].trade;
    } else if (candidates.length === 1) {
      // Single candidate fallback regardless of delta
      bestMatch = candidates[0];
    } else {
      // Multiple candidates, all outside $25 tolerance — defer to combo pass
      return false;
    }
  } else {
    // No journal pnl or outcome hint: single candidate → take it; multiple → skip
    if (candidates.length === 1) {
      bestMatch = candidates[0];
    } else {
      tradesUnmatched++;
      unmatchedDetails.push({
        date: sessionDate,
        ticker: jt.underlying,
        pnl: null,
        reason: `no pnl in journal (header or outcome), ${candidates.length} DB candidates (ambiguous)`,
      });
      return false;
    }
  }

  if (!bestMatch) return false;

  usedFirstExecIds.add(bestMatch.firstExecId);
  await upsertAnnotation(bestMatch.firstExecId, jt);
  tradesMatched++;
  return true;
}

// ---------------------------------------------------------------------------
// Second pass: Combo matching for ×N journal trades.
// Tries combinations of 2..4 unused DB trades for (date, underlying, putCall).
// If a combination's summed realizedPnl is within $25 of the journal pnl,
// annotates EVERY trade in the combo with the same journal content.
// ---------------------------------------------------------------------------

async function comboMatchAndAnnotate(
  jt: ParsedTrade,
  sessionDate: string,
  sessionDbTrades: DbTrade[],
  usedFirstExecIds: Set<string>,
): Promise<void> {
  // Skip combo pass if no pnl to match against
  if (jt.pnl === null) {
    tradesUnmatched++;
    unmatchedDetails.push({
      date: sessionDate,
      ticker: jt.underlying,
      pnl: null,
      reason: `no pnl in journal (header or outcome), multiple DB candidates (ambiguous)`,
    });
    return;
  }

  const candidates = sessionDbTrades.filter((t) => {
    if (t.underlying !== jt.underlying) return false;
    if (jt.putCall !== null && t.putCall !== jt.putCall) return false;
    if (usedFirstExecIds.has(t.firstExecId)) return false;
    return true;
  });

  if (candidates.length < 2) {
    // Still can't combo — record as unmatched
    tradesUnmatched++;
    unmatchedDetails.push({
      date: sessionDate,
      ticker: jt.underlying,
      pnl: jt.pnl,
      reason: `pnl delta too large, only ${candidates.length} unused DB candidate(s) — cannot combo`,
    });
    return;
  }

  const comboIds = findComboMatch(
    jt.pnl,
    candidates.map((t) => ({ firstExecId: t.firstExecId, pnl: t.realizedPnl })),
  );

  if (comboIds === null) {
    tradesUnmatched++;
    unmatchedDetails.push({
      date: sessionDate,
      ticker: jt.underlying,
      pnl: jt.pnl,
      reason: `no combo of 2-4 DB trades sums within $25 of journal pnl (${candidates.length} candidates)`,
    });
    return;
  }

  // Annotate every trade in the winning combo with the same journal content
  for (const id of comboIds) {
    usedFirstExecIds.add(id);
    await upsertAnnotation(id, jt);
  }

  tradesComboMatchedJournal++;
  tradesComboMatchedDb += comboIds.length;
}

// ---------------------------------------------------------------------------
// Copy an image file from journalDir/Media/ → uploads/
// ---------------------------------------------------------------------------

async function copyImage(
  imgName: string,
  sessionDate: string,
  journalDir: string,
  uploadsDir: string,
): Promise<void> {
  const srcPath = path.join(journalDir, 'Media', imgName);
  // Sanitize: spaces → dashes, keep alphanumeric . - _
  const sanitized = imgName.replace(/\s+/g, '-');
  const destName = `${sessionDate}-${sanitized}`;
  const destPath = path.join(uploadsDir, destName);

  // Check source exists
  if (!fs.existsSync(srcPath)) {
    imagesMissing++;
    return;
  }

  // Skip if destination already exists (idempotent)
  if (fs.existsSync(destPath)) {
    imagesSkipped++;
  } else {
    fs.copyFileSync(srcPath, destPath);
    imagesCopied++;
  }

  // Insert attachments row (onConflictDoNothing on fileName)
  await db
    .insert(attachments)
    .values({
      sessionDate,
      fileName: destName,
      caption: null,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
