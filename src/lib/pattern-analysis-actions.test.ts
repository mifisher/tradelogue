import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatternAnalysisOutput } from './pattern-analysis';

const output: PatternAnalysisOutput = {
  summary: 'Rule adherence is the highest-leverage fix.',
  topFocusAreas: [
    {
      title: 'Stop substituting 0DTE',
      why: 'It turns valid theses into outsized losses.',
      action: 'Pass when the correct expiry is too expensive.',
      evidence: ['Rule 13 affected -$837.04'],
    },
  ],
  strengthsToLeanInto: [],
  recurringMistakes: [],
  blindSpots: [],
  nextExperiments: [],
};

const mocks = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const revalidatePath = vi.fn();
  const assemblePatternAnalysisContext = vi.fn();
  const generatePatternAnalysisReview = vi.fn();
  return {
    assemblePatternAnalysisContext,
    generatePatternAnalysisReview,
    insert,
    onConflictDoUpdate,
    revalidatePath,
    values,
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/db', () => ({
  db: {
    insert: mocks.insert,
  },
}));

vi.mock('@/lib/ai/client', () => ({
  aiConfigured: () => true,
  coachModel: () => 'kimi-k2.6',
}));

vi.mock('@/lib/ai/provider', () => ({
  getAiConfig: () => ({ provider: 'moonshot' }),
  invalidApiKeyMessage: () => 'invalid key',
  isAiAuthenticationError: () => false,
  isAiRateLimitError: () => false,
  missingApiKeyMessage: () => 'missing key',
}));

vi.mock('@/lib/pattern-analysis-context-loader', () => ({
  assemblePatternAnalysisContext: mocks.assemblePatternAnalysisContext,
}));

vi.mock('@/lib/ai/pattern-analysis', () => ({
  generatePatternAnalysisReview: mocks.generatePatternAnalysisReview,
}));

describe('generatePatternAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assemblePatternAnalysisContext.mockResolvedValue({
      context: 'pattern context',
      meta: {
        from: '2026-06-01',
        to: '2026-06-18',
        sessions: 3,
        trades: 7,
        totalPnl: -197.5,
      },
    });
    mocks.generatePatternAnalysisReview.mockResolvedValue(output);
  });

  it('upserts the latest all-time pattern analysis and refreshes coach surfaces', async () => {
    const { generatePatternAnalysis } = await import('./pattern-analysis-actions');

    await generatePatternAnalysis();

    expect(mocks.assemblePatternAnalysisContext).toHaveBeenCalledOnce();
    expect(mocks.generatePatternAnalysisReview).toHaveBeenCalledWith('pattern context');
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'all-time',
        dateRangeFrom: '2026-06-01',
        dateRangeTo: '2026-06-18',
        sessionsAnalyzed: 3,
        tradesAnalyzed: 7,
        totalPnl: -197.5,
        summary: output.summary,
        topFocusAreas: output.topFocusAreas,
        model: 'kimi-k2.6',
      }),
    );
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/coach');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/');
  });
});
