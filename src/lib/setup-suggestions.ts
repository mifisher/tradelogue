export type SetupMatchConfidence = 'high' | 'medium' | 'low' | 'none';

export interface SetupSuggestionInput {
  setupMatchConfidence: SetupMatchConfidence;
  setupMatchReason: string;
  suggestedSetupName: string | null;
  suggestedSetupDescription: string | null;
  suggestedSetupEntryCriteria: string | null;
}

export interface SetupSuggestion {
  source: 'voice_fill';
  confidence: 'low' | 'none';
  reason: string;
  name: string;
  description: string;
  entryCriteria: string;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildSetupSuggestion(input: SetupSuggestionInput): SetupSuggestion | null {
  if (input.setupMatchConfidence !== 'low' && input.setupMatchConfidence !== 'none') {
    return null;
  }

  const reason = clean(input.setupMatchReason);
  const name = clean(input.suggestedSetupName);
  const description = clean(input.suggestedSetupDescription);
  const entryCriteria = clean(input.suggestedSetupEntryCriteria);

  if (!reason || !name || !description || !entryCriteria) {
    return null;
  }

  return {
    source: 'voice_fill',
    confidence: input.setupMatchConfidence,
    reason,
    name,
    description,
    entryCriteria,
  };
}

export function nextSetupNumber(numbers: number[]): number {
  if (numbers.length === 0) return 1;
  return Math.max(...numbers) + 1;
}

export function setupSuggestionConfidenceLabel(confidence: SetupSuggestion['confidence']): string {
  return confidence === 'none' ? 'No setup match' : 'Weak setup match';
}
