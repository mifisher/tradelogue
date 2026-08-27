// ── Voice → structured trade notes — provider-neutral structured output ──────
import { z } from 'zod';
import { generateStructuredObject } from './provider';
import { retryTransient } from './coach';

export interface TradeContext {
  underlying: string;
  direction: string;
  pnl: number;
}

export interface SetupContext {
  number: number;
  name: string;
  description: string | null;
  entryCriteria: string | null;
  idealConditions: string | null;
}

// ── Schema (no min/max, per SDK rule) ────────────────────────────────────────
export const SetupMatchConfidenceSchema = z.enum(['high', 'medium', 'low', 'none']);

export const TradeNotesSchema = z.object({
  setupNumber: z.number().nullable(),
  setupMatchConfidence: SetupMatchConfidenceSchema,
  setupMatchReason: z.string(),
  suggestedSetupName: z.string().nullable(),
  suggestedSetupDescription: z.string().nullable(),
  suggestedSetupEntryCriteria: z.string().nullable(),
  grade: z.string().nullable(),
  gradeReason: z.string().nullable(),
  thesis: z.string(),
  executionNotes: z.string(),
});

export type TradeNotesOutput = z.infer<typeof TradeNotesSchema>;

// ── Static system prompt (byte-stable for caching; no per-request data) ───────
export const VOICE_SYSTEM = `You convert a day trader's spoken, free-form account of a single options trade into clean, structured journal fields. The trader day-trades US equity options (long calls/puts, scaling out with partials and a trailed runner).

You are given, in the user message: the trade (ticker, direction, realized P&L), the trader's setup playbook (numbered), and a raw voice transcript that may be rambling, contain filler words, or self-corrections.

Produce four fields:
- setupNumber: the number of the playbook setup that best matches what the trader describes, or null if none clearly fits. Only choose from the numbers provided.
- setupMatchConfidence: high, medium, low, or none. Use high only when the transcript clearly matches one existing setup. Use medium when it mostly matches but there are missing details. Use low when one setup is plausible but weak. Use none when the trade describes a pattern not covered by the current playbook.
- setupMatchReason: one concise sentence explaining why the trade does or does not match the selected setup.
- suggestedSetupName: if confidence is low or none and the transcript suggests a repeatable pattern outside the playbook, propose a concise setup name; otherwise null.
- suggestedSetupDescription: if suggesting a setup, describe the pattern in one or two sentences; otherwise null.
- suggestedSetupEntryCriteria: if suggesting a setup, write concise entry criteria that could become playbook text; otherwise null.
- grade: the trade's execution grade on this scale — A+, A, A-, B+, B, B-, C+, C, C-, D, F. Grade the PROCESS and discipline the trader describes (plan adherence, sizing, management, exits), not merely the dollar outcome. A losing trade well-executed can still grade high; a winning trade taken recklessly can grade low. Use null only if the transcript gives nothing to assess.
- gradeReason: one concise coaching note explaining why the grade was chosen. Call out the main driver, such as entry timing, confirmation quality, sizing, stop discipline, trade management, exit quality, chasing, or late-day context. Use null only when grade is null.
- thesis: a clean, concise statement of why the trader took the trade — what they saw and expected. 1–3 sentences. First person. Do not invent details not present in the transcript.
- executionNotes: a clean, concise account of how it played out — entry, sizing, scaling/management, exit, and any reflection on what went right or wrong. 1–4 sentences. Do not invent details.

Setup matching rules:
- Compare the transcript against the setup description, entry criteria, and ideal conditions.
- If the transcript contradicts a setup's required market context or precondition, do not classify it as a high or medium match even if one detail overlaps.
- Example: if a setup requires a recent 1–3 day uptrend into supply and the transcript says the stock has been in a multi-day downtrend, that is not a confident match for that setup.

Write in the trader's voice, tighten the language, and never fabricate numbers, prices, or events that are not in the transcript.`;

const VOICE_JSON_INSTRUCTION = `The JSON object must have this exact shape:
{
  "setupNumber": 1,
  "setupMatchConfidence": "high",
  "setupMatchReason": "string",
  "suggestedSetupName": null,
  "suggestedSetupDescription": null,
  "suggestedSetupEntryCriteria": null,
  "grade": "A",
  "gradeReason": "string",
  "thesis": "string",
  "executionNotes": "string"
}
Use null for setupNumber, grade, or gradeReason when no clear value is available. Use null suggestion fields unless setupMatchConfidence is low or none and the transcript contains enough detail for a repeatable new setup.`;

/** Build the per-request user message (dynamic data kept out of the system prompt). */
export function buildUserMessage(
  setups: SetupContext[],
  ctx: TradeContext,
  transcript: string,
): string {
  const playbook = setups
    .map(
      (s) =>
        `${s.number} — ${s.name}\n  Pattern: ${s.description ?? '—'}\n  Entry: ${s.entryCriteria ?? '—'}\n  Ideal: ${s.idealConditions ?? '—'}`,
    )
    .join('\n');

  return `## Trade
${ctx.underlying} ${ctx.direction}, realized P&L ${ctx.pnl}

## Setup playbook
${playbook}

## Voice transcript
${transcript}`;
}

/** Synthesize structured trade-note fields from a voice transcript. Throws on API errors. */
export async function synthesizeTradeNotes(
  setups: SetupContext[],
  ctx: TradeContext,
  transcript: string,
): Promise<TradeNotesOutput> {
  // Interactive: the trader is waiting, so this keeps the default budget
  // (~35s of backoff) rather than the brief's patient one.
  return retryTransient(() => generateStructuredObject({
    feature: 'voice',
    // 2048 truncated free reasoning models mid-JSON: their chain of thought ate
    // the budget before the object closed ("truncated before valid JSON"). The
    // ten fields hold only a few sentences, so the real content is small — the
    // headroom is for models that think out loud before answering.
    maxTokens: 16000,
    // NOTE: deliberately no reasoningEffort here. The rule is that the effort hint
    // only helps models whose reasoning is *mandatory* (glm-5.3-flash defaults to
    // "max" and needs 'low' to come down from ~40s). gemini-2.5-flash-lite has
    // reasoning OFF by default, so sending an effort hint ENABLES thinking: 1.4s
    // and 0 reasoning tokens without it, 10.0s and ~2,700 with it. Omitting the
    // parameter is what keeps this path fast. If this slot is ever pointed back at
    // a mandatory-reasoning model, add `reasoningEffort: 'low'` or it will crawl.
    system: VOICE_SYSTEM,
    user: buildUserMessage(setups, ctx, transcript),
    schema: TradeNotesSchema,
    jsonInstruction: VOICE_JSON_INSTRUCTION,
    label: 'Voice synthesis',
  }));
}
