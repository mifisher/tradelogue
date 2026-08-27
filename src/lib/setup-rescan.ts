export interface RescanTranscriptInput {
  thesis: string | null;
  executionNotes: string | null;
}

export interface RescanEligibilityInput extends RescanTranscriptInput {
  setupNumber: number | null;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildRescanTranscript(input: RescanTranscriptInput): string {
  const sections: string[] = [];
  const thesis = clean(input.thesis);
  const executionNotes = clean(input.executionNotes);

  if (thesis) sections.push(`Thesis:\n${thesis}`);
  if (executionNotes) sections.push(`Execution notes:\n${executionNotes}`);

  return sections.join('\n\n');
}

export function shouldScanUntaggedTrade(input: RescanEligibilityInput): boolean {
  if (input.setupNumber != null) return false;
  return buildRescanTranscript(input).length > 0;
}
