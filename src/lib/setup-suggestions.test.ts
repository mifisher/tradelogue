import { describe, expect, it } from 'vitest';
import {
  buildSetupSuggestion,
  nextSetupNumber,
  setupSuggestionConfidenceLabel,
  type SetupSuggestionInput,
} from './setup-suggestions';

const BASE: SetupSuggestionInput = {
  setupMatchConfidence: 'none',
  setupMatchReason: 'The transcript describes a VWAP reclaim pattern outside the current playbook.',
  suggestedSetupName: 'VWAP Reclaim Reversal',
  suggestedSetupDescription: 'A reversal after reclaiming VWAP following an opening flush.',
  suggestedSetupEntryCriteria: 'Opening flush, reclaim VWAP, hold higher low, enter on continuation.',
};

describe('buildSetupSuggestion', () => {
  it('keeps a complete low-confidence new setup suggestion', () => {
    const suggestion = buildSetupSuggestion({ ...BASE, setupMatchConfidence: 'low' });

    expect(suggestion).toEqual({
      source: 'voice_fill',
      confidence: 'low',
      reason: BASE.setupMatchReason,
      name: BASE.suggestedSetupName,
      description: BASE.suggestedSetupDescription,
      entryCriteria: BASE.suggestedSetupEntryCriteria,
    });
  });

  it('keeps a complete no-match new setup suggestion', () => {
    const suggestion = buildSetupSuggestion(BASE);

    expect(suggestion?.confidence).toBe('none');
    expect(suggestion?.name).toBe('VWAP Reclaim Reversal');
  });

  it('drops suggestions for medium and high confidence existing setup matches', () => {
    expect(buildSetupSuggestion({ ...BASE, setupMatchConfidence: 'medium' })).toBeNull();
    expect(buildSetupSuggestion({ ...BASE, setupMatchConfidence: 'high' })).toBeNull();
  });

  it('drops incomplete suggestions', () => {
    expect(buildSetupSuggestion({ ...BASE, suggestedSetupName: null })).toBeNull();
    expect(buildSetupSuggestion({ ...BASE, suggestedSetupDescription: '' })).toBeNull();
    expect(buildSetupSuggestion({ ...BASE, suggestedSetupEntryCriteria: '   ' })).toBeNull();
  });
});

describe('nextSetupNumber', () => {
  it('returns one more than the highest existing setup number', () => {
    expect(nextSetupNumber([1, 4, 2])).toBe(5);
  });

  it('starts at one when there are no setup numbers', () => {
    expect(nextSetupNumber([])).toBe(1);
  });
});

describe('setupSuggestionConfidenceLabel', () => {
  it('labels no-match and weak-match suggestions for review UI', () => {
    expect(setupSuggestionConfidenceLabel('none')).toBe('No setup match');
    expect(setupSuggestionConfidenceLabel('low')).toBe('Weak setup match');
  });
});
