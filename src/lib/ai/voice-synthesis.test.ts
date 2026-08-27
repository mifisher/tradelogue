import { describe, it, expect } from 'vitest';
import {
  TradeNotesSchema,
  buildUserMessage,
  type SetupContext,
  type TradeContext,
} from './voice-synthesis';

const SETUPS: SetupContext[] = [
  {
    number: 1,
    name: 'Opening Range Breakout',
    description: 'Requires a recent 1-3 day uptrend into supply.',
    entryCriteria: 'reject supply',
    idealConditions: 'trend day',
  },
  {
    number: 2,
    name: 'Pre-Market Breakout',
    description: 'Continuation from a tight pre-market range.',
    entryCriteria: 'compression break',
    idealConditions: 'high vol',
  },
];
const CTX: TradeContext = { underlying: 'NVDA', direction: 'long', pnl: -123.45 };

describe('buildUserMessage', () => {
  it('includes the transcript verbatim', () => {
    const msg = buildUserMessage(SETUPS, CTX, 'I took the opening range break and scaled out too early');
    expect(msg).toContain('I took the opening range break and scaled out too early');
  });

  it('includes every setup number and name', () => {
    const msg = buildUserMessage(SETUPS, CTX, 'x');
    expect(msg).toContain('1 — Opening Range Breakout');
    expect(msg).toContain('2 — Pre-Market Breakout');
    expect(msg).toContain('Requires a recent 1-3 day uptrend into supply.');
    expect(msg).toContain('compression break');
  });

  it('includes the trade context (ticker, direction, P&L)', () => {
    const msg = buildUserMessage(SETUPS, CTX, 'x');
    expect(msg).toContain('NVDA');
    expect(msg).toContain('long');
    expect(msg).toContain('-123.45');
  });
});

describe('TradeNotesSchema', () => {
  it('accepts a high-confidence existing setup match', () => {
    const parsed = TradeNotesSchema.parse({
      setupNumber: 1,
      setupMatchConfidence: 'high',
      setupMatchReason: 'The transcript describes a rejection from supply.',
      suggestedSetupName: null,
      suggestedSetupDescription: null,
      suggestedSetupEntryCriteria: null,
      grade: 'A-',
      gradeReason: 'Entry waited for confirmation and exits followed the plan.',
      thesis: 'I expected supply to reject.',
      executionNotes: 'I entered on confirmation and scaled out.',
    });

    expect(parsed.setupNumber).toBe(1);
    expect(parsed.setupMatchConfidence).toBe('high');
    expect(parsed.suggestedSetupName).toBeNull();
  });

  it('accepts a possible new setup suggestion when no existing setup matches', () => {
    const parsed = TradeNotesSchema.parse({
      setupNumber: null,
      setupMatchConfidence: 'none',
      setupMatchReason: 'The transcript describes a reversal pattern not covered by the playbook.',
      suggestedSetupName: 'Opening Drive Reversal',
      suggestedSetupDescription: 'A failed opening drive that reverses through VWAP.',
      suggestedSetupEntryCriteria: 'Opening drive extends, stalls, loses VWAP, then confirms reversal.',
      grade: 'B',
      gradeReason: 'The setup was reasonable, but profit-taking was defensive because continuation was uncertain.',
      thesis: 'I expected the opening drive to unwind.',
      executionNotes: 'I entered after VWAP failed and took profits quickly.',
    });

    expect(parsed.setupNumber).toBeNull();
    expect(parsed.setupMatchConfidence).toBe('none');
    expect(parsed.suggestedSetupName).toBe('Opening Drive Reversal');
  });

  it('accepts a null grade reason when the trade cannot be graded', () => {
    const parsed = TradeNotesSchema.parse({
      setupNumber: null,
      setupMatchConfidence: 'none',
      setupMatchReason: 'The transcript does not include enough setup detail.',
      suggestedSetupName: null,
      suggestedSetupDescription: null,
      suggestedSetupEntryCriteria: null,
      grade: null,
      gradeReason: null,
      thesis: 'I took the trade for a possible continuation.',
      executionNotes: 'The transcript does not describe management details.',
    });

    expect(parsed.grade).toBeNull();
    expect(parsed.gradeReason).toBeNull();
  });
});
