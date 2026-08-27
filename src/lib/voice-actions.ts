'use server';

import { aiConfigured } from '@/lib/ai/client';
import { getSetups } from '@/lib/queries';
import { synthesizeTradeNotes, type TradeContext } from '@/lib/ai/voice-synthesis';
import { buildSetupSuggestion, type SetupMatchConfidence, type SetupSuggestion } from '@/lib/setup-suggestions';
import {
  getAiConfig,
  invalidApiKeyMessage,
  isAiAuthenticationError,
  isAiRateLimitError,
  missingApiKeyMessage,
} from '@/lib/ai/provider';

const VALID_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];

export interface VoiceFillResult {
  setupNumber: number | null;
  setupMatchConfidence: SetupMatchConfidence;
  setupMatchReason: string;
  setupSuggestion: SetupSuggestion | null;
  grade: string | null;
  gradeReason: string | null;
  thesis: string;
  executionNotes: string;
}

export async function synthesizeTradeNotesAction(
  transcript: string,
  ctx: TradeContext,
): Promise<VoiceFillResult> {
  const config = getAiConfig();
  if (!transcript || !transcript.trim()) {
    throw new Error('Nothing to synthesize — record a voice note first.');
  }
  if (!aiConfigured()) {
    throw new Error(missingApiKeyMessage(config));
  }

  const setupRows = await getSetups();
  const setups = setupRows.map((s) => ({
    number: s.number,
    name: s.name,
    description: s.description,
    entryCriteria: s.entryCriteria,
    idealConditions: s.idealConditions,
  }));

  try {
    const out = await synthesizeTradeNotes(setups, ctx, transcript);
    const confidence = out.setupMatchConfidence;
    const setupNumber =
      (confidence === 'high' || confidence === 'medium') &&
      out.setupNumber != null &&
      setups.some((s) => s.number === out.setupNumber)
        ? out.setupNumber
        : null;
    const grade = out.grade && VALID_GRADES.includes(out.grade) ? out.grade : null;
    return {
      setupNumber,
      setupMatchConfidence: confidence,
      setupMatchReason: out.setupMatchReason,
      setupSuggestion: buildSetupSuggestion(out),
      grade,
      gradeReason: grade ? out.gradeReason : null,
      thesis: out.thesis ?? '',
      executionNotes: out.executionNotes ?? '',
    };
  } catch (err) {
    if (isAiAuthenticationError(err)) {
      throw new Error(invalidApiKeyMessage(config));
    }
    if (isAiRateLimitError(err)) {
      throw new Error('Rate limited by the API — try again in a minute');
    }
    throw err;
  }
}
