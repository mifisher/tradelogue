'use server';

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { sessions, tradeAnnotations, attachments, setups } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { nextSetupNumber, type SetupSuggestion } from '@/lib/setup-suggestions';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const VALID_SENTIMENTS = ['Bullish', 'Bearish', 'Uncertain', 'Upbeat'] as const;
const VALID_GRADES = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D', 'F',
] as const;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Wrap revalidatePath so actions are also callable from CLI scripts (Task 6 migrator).
 *  Outside a Next.js request context this throws 'static generation store' — swallow it. */
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // ignore Next.js context errors (e.g. when called from CLI scripts)
  }
}

function validateDateFormat(date: string, name = 'sessionDate') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${name} must be in YYYY-MM-DD format, got: ${date}`);
  }
}

// ── Session ────────────────────────────────────────────────────────────────

export interface SessionFields {
  sentiment?: string | null;
  mood?: string | null;
  sleepScore?: number | null;
  sleepMinutes?: number | null;
  marketContext?: string | null;
  recap?: string | null;
}

export async function saveSession(
  sessionDate: string,
  fields: SessionFields,
): Promise<void> {
  validateDateFormat(sessionDate);

  if (fields.sentiment != null && !VALID_SENTIMENTS.includes(fields.sentiment as typeof VALID_SENTIMENTS[number])) {
    throw new Error(`sentiment must be one of ${VALID_SENTIMENTS.join(', ')}, got: ${fields.sentiment}`);
  }

  await db
    .insert(sessions)
    .values({
      sessionDate,
      sentiment: fields.sentiment ?? null,
      mood: fields.mood ?? null,
      sleepScore: fields.sleepScore ?? null,
      sleepMinutes: fields.sleepMinutes ?? null,
      marketContext: fields.marketContext ?? null,
      recap: fields.recap ?? null,
    })
    .onConflictDoUpdate({
      target: sessions.sessionDate,
      set: {
        sentiment: fields.sentiment ?? null,
        mood: fields.mood ?? null,
        sleepScore: fields.sleepScore ?? null,
        sleepMinutes: fields.sleepMinutes ?? null,
        marketContext: fields.marketContext ?? null,
        recap: fields.recap ?? null,
        updatedAt: new Date(),
      },
    });

  safeRevalidate('/day/' + sessionDate);
}

/**
 * Seed a session's market context from the day's market-brief overview so the
 * trader does not have to copy it in by hand. Runs on every brief generation
 * (the 5am scheduled job and every manual refresh), so it must be strictly
 * non-destructive: the setWhere guard makes the write fire only when the field
 * is still absent or blank, so a value the trader has typed — or an earlier
 * prefill they then edited — is never overwritten.
 */
export async function prefillMarketContext(
  sessionDate: string,
  overview: string,
): Promise<void> {
  validateDateFormat(sessionDate);
  const text = overview.trim();
  if (!text) return;

  await db
    .insert(sessions)
    .values({ sessionDate, marketContext: text })
    .onConflictDoUpdate({
      target: sessions.sessionDate,
      set: { marketContext: text, updatedAt: new Date() },
      setWhere: sql`${sessions.marketContext} is null or length(btrim(${sessions.marketContext})) = 0`,
    });

  safeRevalidate('/day/' + sessionDate);
}

// ── Annotation ─────────────────────────────────────────────────────────────

export interface AnnotationFields {
  setupNumber?: number | null;
  thesis?: string | null;
  executionNotes?: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  setupSuggestion?: SetupSuggestion | null;
}

export async function saveAnnotation(
  firstExecId: string,
  sessionDate: string,
  fields: AnnotationFields,
): Promise<void> {
  if (!firstExecId) throw new Error('firstExecId is required');
  validateDateFormat(sessionDate);

  if (
    fields.grade != null &&
    !VALID_GRADES.includes(fields.grade as typeof VALID_GRADES[number])
  ) {
    throw new Error(`grade must be one of ${VALID_GRADES.join(', ')}, got: ${fields.grade}`);
  }

  await db
    .insert(tradeAnnotations)
    .values({
      firstExecId,
      setupNumber: fields.setupNumber ?? null,
      thesis: fields.thesis ?? null,
      executionNotes: fields.executionNotes ?? null,
      grade: fields.grade ?? null,
      gradeReason: fields.gradeReason ?? null,
      setupSuggestion: fields.setupSuggestion ?? null,
    })
    .onConflictDoUpdate({
      target: tradeAnnotations.firstExecId,
      set: {
        setupNumber: fields.setupNumber ?? null,
        thesis: fields.thesis ?? null,
        executionNotes: fields.executionNotes ?? null,
        grade: fields.grade ?? null,
        gradeReason: fields.gradeReason ?? null,
        setupSuggestion: fields.setupSuggestion ?? null,
        updatedAt: new Date(),
      },
    });

  safeRevalidate('/day/' + sessionDate);
}

export async function createSetupFromSuggestion(
  firstExecId: string,
  sessionDate: string,
  suggestion: SetupSuggestion,
): Promise<{ setupNumber: number }> {
  if (!firstExecId) throw new Error('firstExecId is required');
  validateDateFormat(sessionDate);
  if (!suggestion.name.trim()) throw new Error('setup suggestion name is required');
  if (!suggestion.description.trim()) throw new Error('setup suggestion description is required');
  if (!suggestion.entryCriteria.trim()) throw new Error('setup suggestion entry criteria is required');

  const rows = await db.select({ number: setups.number }).from(setups);
  const number = nextSetupNumber(rows.map((r) => r.number));

  await db.insert(setups).values({
    number,
    name: suggestion.name.trim(),
    description: suggestion.description.trim(),
    entryCriteria: suggestion.entryCriteria.trim(),
    alsoCalled: null,
    whyItWorks: null,
    target: null,
    management: null,
    stopPlacement: null,
    idealConditions: null,
    watchOuts: `Created from AI suggestion for trade ${firstExecId}. Reason: ${suggestion.reason}`,
  });

  await db
    .insert(tradeAnnotations)
    .values({
      firstExecId,
      setupNumber: number,
      setupSuggestion: null,
    })
    .onConflictDoUpdate({
      target: tradeAnnotations.firstExecId,
      set: {
        setupNumber: number,
        setupSuggestion: null,
        updatedAt: new Date(),
      },
    });

  safeRevalidate('/setups');
  safeRevalidate(`/setups/${number}`);
  safeRevalidate('/day/' + sessionDate);
  safeRevalidate('/trade/' + firstExecId);

  return { setupNumber: number };
}

export async function dismissSetupSuggestion(
  firstExecId: string,
  sessionDate: string,
): Promise<void> {
  if (!firstExecId) throw new Error('firstExecId is required');
  validateDateFormat(sessionDate);

  await db
    .update(tradeAnnotations)
    .set({
      setupSuggestion: null,
      updatedAt: new Date(),
    })
    .where(eq(tradeAnnotations.firstExecId, firstExecId));

  safeRevalidate('/setups');
  safeRevalidate('/day/' + sessionDate);
  safeRevalidate('/trade/' + firstExecId);
}

// ── Attachments ────────────────────────────────────────────────────────────

/** Validate an uploaded image (presence, MIME type, size) and return its extension. */
function assertImageFile(file: FormDataEntryValue | null): { file: File; ext: string } {
  if (!(file instanceof File)) {
    throw new Error('form field "file" is required and must be a File');
  }
  const ext = MIME_TO_EXT[file.type];
  if (!ext) {
    throw new Error(
      `file type "${file.type}" is not allowed; must be png, jpeg, or webp`,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`file size ${file.size} exceeds 10 MB limit`);
  }
  return { file, ext };
}

/** Persist an uploaded image to the uploads dir and return its generated file name. */
async function persistUpload(sessionDate: string, file: File, ext: string): Promise<string> {
  const fileName = `${sessionDate}-${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const bytes = await file.arrayBuffer();
  await fs.writeFile(path.join(UPLOADS_DIR, fileName), Buffer.from(bytes));
  return fileName;
}

export async function uploadAttachment(
  sessionDate: string,
  formData: FormData,
  firstExecId?: string | null,
): Promise<void> {
  validateDateFormat(sessionDate);

  const { file, ext } = assertImageFile(formData.get('file'));
  const fileName = await persistUpload(sessionDate, file, ext);

  await db.insert(attachments).values({
    sessionDate,
    firstExecId: firstExecId ?? null,
    fileName,
  });

  safeRevalidate('/day/' + sessionDate);
  if (firstExecId) safeRevalidate('/trade/' + firstExecId);
}

/**
 * Set the single chart screenshot for a trade. Opinionated: replaces any existing
 * trade-level screenshot for this firstExecId (one chart per trade).
 *
 * Future: this is the seam where a TradingView integration would pull a chart
 * automatically and overlay entry/exit instead of a manual upload.
 */
export async function setTradeChart(
  sessionDate: string,
  firstExecId: string,
  formData: FormData,
): Promise<void> {
  validateDateFormat(sessionDate);
  if (!firstExecId) throw new Error('firstExecId is required');

  const { file, ext } = assertImageFile(formData.get('file'));

  // Remove any existing chart(s) for this trade — one screenshot per trade.
  const existing = await db
    .select()
    .from(attachments)
    .where(eq(attachments.firstExecId, firstExecId));
  for (const row of existing) {
    await db.delete(attachments).where(eq(attachments.id, row.id));
    try {
      await fs.unlink(path.join(UPLOADS_DIR, row.fileName));
    } catch {
      // file missing is fine
    }
  }

  const fileName = await persistUpload(sessionDate, file, ext);
  await db.insert(attachments).values({ sessionDate, firstExecId, fileName });

  safeRevalidate('/day/' + sessionDate);
  safeRevalidate('/trade/' + firstExecId);
}

export async function deleteAttachment(
  id: number,
  sessionDate: string,
): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`id must be a positive integer, got: ${id}`);
  }
  validateDateFormat(sessionDate);

  // Fetch the row to get the fileName before deleting
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id));

  if (rows.length > 0) {
    const { fileName, firstExecId } = rows[0];
    await db.delete(attachments).where(eq(attachments.id, id));

    // Remove the file — ignore if already missing
    try {
      await fs.unlink(path.join(UPLOADS_DIR, fileName));
    } catch {
      // file missing is fine
    }

    if (firstExecId) safeRevalidate('/trade/' + firstExecId);
  }

  safeRevalidate('/day/' + sessionDate);
}
