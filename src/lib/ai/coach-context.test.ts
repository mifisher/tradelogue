import { describe, it, expect } from 'vitest';
import { buildCoachContext } from './coach-context';
import type { CoachContextInput } from './coach-context';

// Helper to build a minimal valid input; tests mutate the returned object for per-field overrides
function mkInput(): CoachContextInput {
  return {
    session: {
      sessionDate: '2026-06-08',
      sentiment: 'Uncertain',
      mood: 'Focused',
      sleepScore: 8,
      sleepMinutes: 420,
      marketContext: 'SPY flat, QQQ -0.3%, VIX elevated',
      recap: 'Two QQQ trades, both losers. Should have stopped after first loss.',
      journalPnl: -250,
    },
    trades: [
      {
        timePT: '09:35',
        ticker: 'QQQ',
        description: 'QQQ 12JUN26 460.0 P',
        qty: 2,
        entry: 3.5,
        exit: 2.8,
        holdMs: 9 * 60 * 1000,
        pnl: -140,
        setupName: 'Gap-Fade',
        grade: 'C',
        thesis: 'Supply rejection at VWAP',
        executionNotes: 'Exited too early',
      },
      {
        timePT: '10:02',
        ticker: 'QQQ',
        description: 'QQQ 12JUN26 458.0 P',
        qty: 1,
        entry: 2.1,
        exit: 1.5,
        holdMs: 15 * 60 * 1000,
        pnl: -60,
        setupName: null,
        grade: null,
        thesis: null,
        executionNotes: null,
      },
    ],
    rulebook: [
      { rule: 1, title: 'Maximum position outlay', description: 'Position cost must not exceed the cap.' },
      { rule: 2, title: 'Loss pause before re-entry', description: 'Wait before re-entering a losing name.' },
    ],
    setupNames: [{ number: 1, name: 'Opening Range Breakout' }],
    violations: [
      {
        rule: 15,
        title: 'Overtrading a chop day',
        scope: 'session',
        detail: '5 trades on an Uncertain tape exceeds the 3-trade cap.',
      },
      {
        rule: 4,
        title: 'Re-entry without pause',
        scope: 'trade',
        firstExecId: 'e2',
        detail: 'Re-entered QQQ 7m after a losing exit.',
      },
    ],
    recentDays: [
      { day: '2026-06-05', pnl: 320, tradeCount: 3, violationCount: 0 },
      { day: '2026-06-06', pnl: -180, tradeCount: 4, violationCount: 2 },
      { day: '2026-06-08', pnl: -250, tradeCount: 2, violationCount: 2 },
    ],
    allTime: {
      totalPnl: 4200,
      winRateDays: 0.58,
      profitFactor: 1.4,
    },
  };
}

describe('buildCoachContext', () => {
  it('includes session date in output', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('2026-06-08');
  });

  it('includes sentiment', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('Uncertain');
  });

  it('includes market context', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('SPY flat');
  });

  it('includes recap', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('Should have stopped after first loss');
  });

  it('includes trade ticker', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('QQQ');
  });

  it('includes trade time', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('09:35');
  });

  it('includes trade pnl', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('-$140.00');
  });

  it('includes entry and exit prices', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('3.5');
    expect(ctx).toContain('2.8');
  });

  it('includes setup name when present', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('Gap-Fade');
  });

  it('includes grade when present', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('grade: C');
  });

  it('includes violation rule numbers', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('R15');
    expect(ctx).toContain('R4');
  });

  it('includes violation detail text', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('5 trades on an Uncertain tape');
  });

  it('includes recent session dates', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('2026-06-05');
    expect(ctx).toContain('2026-06-06');
  });

  it('includes all-time stats', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('4,200');
  });

  it('includes profit factor', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('1.4');
  });

  it('handles null journal fields with placeholder', () => {
    const input = mkInput();
    input.session.mood = null;
    input.session.sleepScore = null;
    input.session.sleepMinutes = null;
    input.session.marketContext = null;
    input.session.recap = null;
    const ctx = buildCoachContext(input);
    expect(ctx.match(/\(not journaled\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('shows None detected when violations array is empty', () => {
    const input = mkInput();
    input.violations = [];
    const ctx = buildCoachContext(input);
    expect(ctx).toContain('None detected');
  });

  it('produces stable output for identical inputs (deterministic)', () => {
    const input = mkInput();
    expect(buildCoachContext(input)).toBe(buildCoachContext(input));
  });

  it('includes the ## Trades section header', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('## Trades');
  });

  it('includes ## Detected rule violations section', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('## Detected rule violations');
  });

  it('includes ## Recent sessions section', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('## Recent sessions');
  });

  it('includes ## All-time section', () => {
    const ctx = buildCoachContext(mkInput());
    expect(ctx).toContain('## All-time');
  });

  it('shows null grade and setup as (not annotated)', () => {
    const ctx = buildCoachContext(mkInput());
    // second trade has null grade and null setup
    expect(ctx).toContain('not annotated');
  });

  it('includes hold time in human-readable form', () => {
    const ctx = buildCoachContext(mkInput());
    // 9 minutes → '9m'
    expect(ctx).toContain('9m');
  });
});
