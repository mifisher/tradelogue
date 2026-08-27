// ── AI coaching engine — provider-neutral structured output ─────────────────
import { z } from 'zod';
import {
  AiProviderError,
  generateStructuredObject,
  isAiAuthenticationError,
  isAiTruncationError,
} from './provider';

// ── Schema ───────────────────────────────────────────────────────────────────

const CoachingSchema = z.object({
  whatWorked: z.array(z.string()),
  toImprove: z.array(z.string()),
  patternsToWatch: z.array(z.string()),
});

export type CoachingOutput = z.infer<typeof CoachingSchema>;

// ── System prompt — built ONCE at module load so the bytes are stable ────────
// The system prompt must never have per-request data (no dates, IDs, etc.)
// so that the cache_control hit rate stays high. That now includes the
// rulebook and the setup list: both are user-managed, so they travel with the
// per-request context instead of being frozen here at module load.

/** Render a rulebook as numbered lines. Used by the eval judge, which must
 *  grade citations against the same rules the coach was given. */
export function buildRulesBlock(
  rules: Array<{ rule: number; title: string; description: string }>,
): string {
  return [...rules]
    .sort((a, b) => a.rule - b.rule)
    .map((r) => `Rule ${r.rule} — ${r.title}: ${r.description}`)
    .join('\n');
}

export const COACH_SYSTEM = `You are a trading coach at a top proprietary trading firm reviewing a day trader's session. The trader day-trades US equity options (long calls/puts, typically scaling out with partials and trailing any runners). Coach against their own numbered rulebook and named setups. Be direct, specific, and quantitative — cite the actual trades, times, and dollar amounts from the session data. Acknowledge what was done well honestly; never invent trades or numbers not in the data. Each list item is one to three sentences.

The trader's rulebook and named setups are supplied with each session's context — grade against those, and never cite a rule number that is not in that list.

## Output format
Respond in three sections:
- whatWorked: bullet points of things the trader did well this session (be honest — if nothing, say so briefly)
- toImprove: bullet points of specific behaviors to fix, citing rule numbers where applicable
- patternsToWatch: bullet points of recurring patterns across the session and recent history to monitor going forward

Be concise: aim for 2–4 bullets per section. Each bullet is 1–3 sentences. No markdown headers in the bullets — just the content.`;

const COACH_JSON_INSTRUCTION = `The JSON object must have this exact shape:
{
  "whatWorked": ["string"],
  "toImprove": ["string"],
  "patternsToWatch": ["string"]
}`;

// ── Generator ────────────────────────────────────────────────────────────────

/** Free-tier models fail transiently in ways a second attempt fixes: a rate
 * limit under load, an empty completion, or a slip that returns a bare string
 * where the schema wants an array. One shot turned each of those into a visible
 * failure for the trader. */
const MAX_ATTEMPTS = 4;
/** Tuned to a measured throttle, not a guess: probing stealth/ox-alpha at 30s
 * intervals gave 200/200/200/200/200/429/429/429/200/200 — windows stay shut
 * for a minute or more. A 1.5s-2s base never outlived one. Four attempts at 5s
 * doubling spans ~35s, which a trader will sit through when the alternative is
 * a hard failure. Long-prompt callers (the brief) pass patient overrides. */
const RETRY_BASE_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Retry a generation call on transient failures, backing off between tries.
 * Authentication errors are rethrown immediately — a bad key does not fix
 * itself, and retrying only makes the trader wait longer to hear about it.
 *
 * Backoff doubles rather than growing linearly. A throttled model (measured on
 * stealth/ox-alpha: 429 in under a second, no Retry-After header, roughly half
 * of all requests refused) outran the old 0/1.5s/3s schedule — all three
 * attempts were spent inside ~4.5s while the throttle was still closed, and the
 * trader saw a hard failure. When the provider does send a Retry-After, that
 * wins: it knows when the window reopens and we are only guessing. */
export async function retryTransient<T>(
  call: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    attempts = MAX_ATTEMPTS,
    baseDelayMs = RETRY_BASE_DELAY_MS,
    maxDelayMs = MAX_RETRY_DELAY_MS,
    sleep = defaultSleep,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const hinted =
        lastError instanceof AiProviderError ? lastError.retryAfterMs : undefined;
      await sleep(Math.max(backoff, hinted ?? 0));
    }
    try {
      return await call();
    } catch (err) {
      if (isAiAuthenticationError(err)) throw err;
      // Truncation is deterministic, not transient: the same prompt reasons past
      // the same cap every time, so retrying only multiplies the wait.
      if (isAiTruncationError(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Generate a structured coaching review from the session context string.
 * Throws on API errors — callers should handle provider-neutral AI errors.
 */
export async function generateCoachingReview(
  context: string,
  retryOpts?: RetryOptions,
): Promise<CoachingOutput> {
  return retryTransient(
    () =>
      generateStructuredObject({
        feature: 'coach',
        maxTokens: 16000,
        thinking: { type: 'adaptive' },
        system: COACH_SYSTEM,
        user: `Review this session:\n\n${context}`,
        schema: CoachingSchema,
        jsonInstruction: COACH_JSON_INSTRUCTION,
        label: 'Coaching generation',
      }),
    retryOpts,
  );
}
