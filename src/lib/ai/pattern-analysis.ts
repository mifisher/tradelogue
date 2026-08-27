import { generateStructuredObject } from './provider';
import { retryTransient } from './coach';
import {
  PatternAnalysisOutputSchema,
  type PatternAnalysisOutput,
} from '@/lib/pattern-analysis';
export const PATTERN_ANALYSIS_SYSTEM = `You are a trading performance coach reviewing a day trader's full journal history. The trader day-trades US equity options and wants recurring-pattern analysis across their whole history, not a single-day review.

Your job is to synthesize patterns across many sessions, not review one day. Be blunt, practical, and evidence-led. Identify the highest-leverage behaviors that will improve the equity curve. Distinguish between:
- recurring mistakes that cost money,
- strengths that should be protected and scaled,
- blind spots the trader may not notice from daily reviews,
- concrete experiments for the next 5-10 sessions.

Use the evidence provided. Cite actual rules, date clusters, setups, segments, P&L, win rates, and annotated trade notes when relevant. Do not invent trades, dates, or dollar amounts. If evidence is thin, say so.

The trader's rulebook is supplied with the evidence below — cite only rule numbers that appear there.

## Output guidance
- topFocusAreas: exactly 3 items. These are the dashboard priorities. Make them direct enough to act on before the next session.
- strengthsToLeanInto: 2-5 items.
- recurringMistakes: 3-6 items.
- blindSpots: 2-5 items.
- nextExperiments: 2-5 items with measurable protocols.
- Every insight needs evidence. Use concise strings, not paragraphs.
- Keep action text specific and behavioral. Avoid vague advice like "be disciplined."
`;

const PATTERN_ANALYSIS_JSON_INSTRUCTION = `The JSON object must have this exact shape:
{
  "summary": "string",
  "topFocusAreas": [
    { "title": "string", "why": "string", "action": "string", "evidence": ["string"] }
  ],
  "strengthsToLeanInto": [
    { "title": "string", "why": "string", "action": "string", "evidence": ["string"] }
  ],
  "recurringMistakes": [
    { "title": "string", "why": "string", "action": "string", "evidence": ["string"] }
  ],
  "blindSpots": [
    { "title": "string", "why": "string", "action": "string", "evidence": ["string"] }
  ],
  "nextExperiments": [
    { "title": "string", "hypothesis": "string", "protocol": "string", "successMetric": "string" }
  ]
}`;

export async function generatePatternAnalysisReview(
  context: string,
): Promise<PatternAnalysisOutput> {
  return retryTransient(() => generateStructuredObject({
    feature: 'coach',
    // Shares the 'coach' model slot but not its shape: this prompt spans the
    // whole journal (~233k chars, ~59k prompt tokens) against a richer schema,
    // and glm-5.3-flash spent 47.8k chars — ~12k tokens — on reasoning alone,
    // blowing the 16000 that is ample for a single-session coach review.
    maxTokens: 32000,
    thinking: { type: 'adaptive' },
    system: PATTERN_ANALYSIS_SYSTEM,
    user: `Analyze recurring trading patterns across this full journal evidence pack:\n\n${context}`,
    schema: PatternAnalysisOutputSchema,
    jsonInstruction: PATTERN_ANALYSIS_JSON_INSTRUCTION,
    label: 'Pattern analysis generation',
  }));
}
