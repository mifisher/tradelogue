// ── LLM judge — scores AI coaching reviews against human ground truth ─────────
// Uses the configured AI provider with adaptive thinking where supported.
// The judge is an independent evaluator: human review = ground truth for WHAT
// mattered in the session, not for style or phrasing.

import { z } from 'zod';
import { generateStructuredObject } from './provider';
import { retryTransient } from './coach';

// ── Schema — no min/max per SDK rules ────────────────────────────────────────

export const JudgeSchema = z.object({
  factualAccuracy: z.number(),       // 1–5: no invented trades/numbers; times and P&L match context
  issueOverlap: z.number(),          // 1–5: identifies the same key problems the human coach found
  ruleGrounding: z.number(),         // 1–5: cites applicable numbered rules correctly
  actionability: z.number(),         // 1–5: concrete next-session behaviors vs platitudes
  missedCriticalInsight: z.boolean(),// human review contains a load-bearing insight the AI missed entirely
  comments: z.string(),              // brief explanation of scores + any critical insight gap
});

export type JudgeOutput = z.infer<typeof JudgeSchema>;

// ── Static system prompt — byte-stable for caching ───────────────────────────
// No per-request data (no dates, session IDs, etc.).

const JUDGE_SYSTEM = `You are an independent evaluator assessing the quality of AI-generated trading coaching reviews. You will be given:
1. The trader's numbered rulebook (the same one the AI coach was given)
2. Session context (the raw data the AI coach had access to)
3. A human coach's review (written by an experienced human — this is the GROUND TRUTH for what mattered in the session)
4. An AI-generated coaching review (what you are evaluating)

Your job is to score the AI review on four dimensions (each 1–5, where 5 = excellent):

factualAccuracy (1–5): Does the AI review accurately reflect the session data? Penalise invented trades, wrong prices, wrong timestamps, or numbers not in the context. Rule titles and thresholds drawn from the rulebook are NOT inventions. 5 = every factual claim is verifiable from the context. 1 = multiple invented or wrong facts.

issueOverlap (1–5): Does the AI review identify the same KEY problems and successes the human coach highlighted? The human review is ground truth for WHAT mattered — not for phrasing or style. 5 = captures all critical points the human raised. 1 = misses most of what the human flagged as important.

ruleGrounding (1–5): When the AI mentions rules or setups, are they correctly applied to the session? Check every citation against the rulebook above — it is the authority on which rules exist and what they say. A rule cited by number that matches the rulebook is CORRECT even though the session context does not restate it; do not treat it as invented. Penalise only citations that contradict the rulebook or are applied to a situation the rule does not cover. 5 = rule citations are accurate and relevant. 1 = rules cited are wrong or inapplicable. N/A sessions (no rule violations) should default to 3.

actionability (1–5): Are the AI's improvement suggestions concrete and specific to THIS session, or are they generic platitudes? 5 = clear, specific next-session behaviors a trader could act on. 1 = vague advice that could apply to any session.

missedCriticalInsight (boolean): Does the human review contain a load-bearing insight — something that fundamentally explains the session outcome or a dangerous pattern — that the AI completely missed? true = yes, the AI missed something important the human caught. false = the AI covered the critical ground.

comments: 2–4 sentences explaining your scores, highlighting the most important gap or strength. Be specific about what the AI got right or wrong. If missedCriticalInsight is true, quote or paraphrase the human's missed insight.

Be calibrated and honest. The goal is to measure where AI coaching falls short of human coaching, not to be generous or harsh.`;

const JUDGE_JSON_INSTRUCTION = `The JSON object must have this exact shape:
{
  "factualAccuracy": 1,
  "issueOverlap": 1,
  "ruleGrounding": 1,
  "actionability": 1,
  "missedCriticalInsight": false,
  "comments": "string"
}`;

// ── Judge function ────────────────────────────────────────────────────────────

export interface JudgeInput {
  context: string;      // assembled session context (same text sent to the AI coach)
  humanReview: string;  // verbatim human-written coaching review (ground truth)
  aiReview: string;     // the AI-generated review to evaluate
}

/**
 * Judge an AI coaching review against the human ground truth.
 * Returns structured scores, or null if the model returns no parseable output.
 */
export async function judgeReview(input: JudgeInput): Promise<JudgeOutput | null> {
  // The judge MUST see the same rulebook the coach was given. It now travels
  // inside the session context, so passing the context through is enough.
  // Do not drop it: without the rules, the judge cannot verify a single rule
  // citation and scores every correct one as a fabrication.
  const userMessage = `## Session context (includes the trader's rulebook)\n\n${input.context}\n\n---\n\n## Human coach review (ground truth)\n\n${input.humanReview}\n\n---\n\n## AI-generated review to evaluate\n\n${input.aiReview}`;

  // Patient like the brief: the eval harness runs unattended, and a judge call
  // carries context + both reviews, so it is long enough to be refused first.
  // Unretried, a single 429 or a dropped connection ("terminated") voided the
  // whole session's score.
  return retryTransient(() => generateStructuredObject({
    feature: 'judge',
    maxTokens: 16000,
    thinking: { type: 'adaptive' },
    system: JUDGE_SYSTEM,
    user: userMessage,
    schema: JudgeSchema,
    jsonInstruction: JUDGE_JSON_INSTRUCTION,
    label: 'Judge review',
  }), { attempts: 5, baseDelayMs: 15_000, maxDelayMs: 60_000 });
}
