import { describe, it, expect } from 'vitest';
import { monthView } from './calendar';
import type { DailySummaryLike } from './calendar';

// Helper to build a DailySummaryLike quickly
function day(date: string, pnl: number, tradeCount = 1): DailySummaryLike {
  return { day: date, pnl, tradeCount };
}

describe('monthView — 2026-05 (starts Friday)', () => {
  const days2605: DailySummaryLike[] = [
    day('2026-05-01', 200, 3),  // Friday
    day('2026-05-11', 150, 2),  // Monday
    day('2026-05-12', -50, 1),  // Tuesday
    day('2026-05-13', 300, 4),  // Wednesday
    day('2026-05-14', -100, 2), // Thursday
    day('2026-05-15', 75, 1),   // Friday
    day('2026-05-29', -30, 1),  // Friday
  ];

  it('title and ym', () => {
    const mv = monthView('2026-05', days2605);
    expect(mv.ym).toBe('2026-05');
    expect(mv.title).toBe('May 2026');
  });

  it('prevYm and nextYm', () => {
    const mv = monthView('2026-05', days2605);
    expect(mv.prevYm).toBe('2026-04');
    expect(mv.nextYm).toBe('2026-06');
  });

  it('first week: 4 placeholder cells then May 1 (Friday)', () => {
    const mv = monthView('2026-05', days2605);
    const firstWeek = mv.weeks[0];
    expect(firstWeek.cells).toHaveLength(5);
    // Mon–Thu are placeholders (date === '')
    expect(firstWeek.cells[0].date).toBe('');
    expect(firstWeek.cells[1].date).toBe('');
    expect(firstWeek.cells[2].date).toBe('');
    expect(firstWeek.cells[3].date).toBe('');
    // Friday = May 1
    expect(firstWeek.cells[4].date).toBe('2026-05-01');
    expect(firstWeek.cells[4].summary?.pnl).toBe(200);
  });

  it('week of May 11–15 lands in one row in Mon–Fri order', () => {
    const mv = monthView('2026-05', days2605);
    // Find the week containing 2026-05-11
    const week = mv.weeks.find(w => w.cells.some(c => c.date === '2026-05-11'));
    expect(week).toBeDefined();
    const dates = week!.cells.map(c => c.date);
    expect(dates).toEqual(['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']);
  });

  it('weekPnl sums traded days in that week', () => {
    const mv = monthView('2026-05', days2605);
    const week = mv.weeks.find(w => w.cells.some(c => c.date === '2026-05-11'));
    // 150 + (-50) + 300 + (-100) + 75 = 375
    expect(week!.weekPnl).toBeCloseTo(375);
  });

  it('first week weekPnl = 200 (only May 1 traded)', () => {
    const mv = monthView('2026-05', days2605);
    expect(mv.weeks[0].weekPnl).toBeCloseTo(200);
  });

  it('week with no traded days has weekPnl = null', () => {
    // Find a week with no summaries
    const mv = monthView('2026-05', days2605);
    const emptyWeek = mv.weeks.find(w => w.weekPnl === null);
    expect(emptyWeek).toBeDefined();
  });

  it('monthTotal sums all provided days', () => {
    const mv = monthView('2026-05', days2605);
    // 200 + 150 + (-50) + 300 + (-100) + 75 + (-30) = 545
    expect(mv.monthTotal).toBeCloseTo(545);
  });

  it('greenDays and redDays correct', () => {
    const mv = monthView('2026-05', days2605);
    // green: 200, 150, 300, 75 = 4
    // red (pnl <= 0): -50, -100, -30 = 3
    expect(mv.greenDays).toBe(4);
    expect(mv.redDays).toBe(3);
  });
});

describe('monthView — year boundary', () => {
  it('2026-01 → prevYm 2025-12, nextYm 2026-02, title January 2026', () => {
    const mv = monthView('2026-01', []);
    expect(mv.prevYm).toBe('2025-12');
    expect(mv.nextYm).toBe('2026-02');
    expect(mv.title).toBe('January 2026');
  });

  it('2025-12 → prevYm 2025-11, nextYm 2026-01', () => {
    const mv = monthView('2025-12', []);
    expect(mv.prevYm).toBe('2025-11');
    expect(mv.nextYm).toBe('2026-01');
  });
});

describe('monthView — green/red semantics', () => {
  it('pnl=0 counts as red (traded with zero = loss-side scratch)', () => {
    // Pick weekdays in any month: use 2026-06-01 (Monday), 06-02 (Tue), 06-03 (Wed)
    const days: DailySummaryLike[] = [
      day('2026-06-01', 10),
      day('2026-06-02', -5),
      day('2026-06-03', 0),
    ];
    const mv = monthView('2026-06', days);
    expect(mv.greenDays).toBe(1);
    expect(mv.redDays).toBe(2);
  });
});

describe('monthView — weekend trade safety', () => {
  it('summary on a Saturday does NOT crash and IS included in monthTotal', () => {
    // 2026-05-02 is a Saturday
    const days: DailySummaryLike[] = [
      day('2026-05-02', 500),  // Saturday — unusual but must not crash
      day('2026-05-04', 100),  // Monday — normal
    ];
    expect(() => monthView('2026-05', days)).not.toThrow();
    const mv = monthView('2026-05', days);
    // monthTotal should include both
    expect(mv.monthTotal).toBeCloseTo(600);
    // But the Saturday cell should NOT appear in any week's Mon-Fri grid
    const allCells = mv.weeks.flatMap(w => w.cells);
    expect(allCells.some(c => c.date === '2026-05-02')).toBe(false);
  });

  it('weekend trade is included in greenDays count', () => {
    const days: DailySummaryLike[] = [
      day('2026-05-02', 500), // Saturday — green
    ];
    const mv = monthView('2026-05', days);
    expect(mv.greenDays).toBe(1);
  });
});

describe('monthView — empty month', () => {
  it('returns weeks with no summaries and zeroed totals', () => {
    const mv = monthView('2026-05', []);
    expect(mv.monthTotal).toBe(0);
    expect(mv.greenDays).toBe(0);
    expect(mv.redDays).toBe(0);
    expect(mv.weeks.length).toBeGreaterThan(0);
  });
});

describe('monthView — cell alignment', () => {
  it('every week row has exactly 5 cells', () => {
    const mv = monthView('2026-05', []);
    for (const week of mv.weeks) {
      expect(week.cells).toHaveLength(5);
    }
  });

  it('in-month weekday cells have correct date strings', () => {
    const mv = monthView('2026-05', []);
    const allDates = mv.weeks.flatMap(w => w.cells.map(c => c.date)).filter(d => d !== '');
    // May 2026 has weekdays from May 1 (Fri) to May 29 (Fri)
    // Should contain May 1 and May 29 as last weekday
    expect(allDates).toContain('2026-05-01');
    expect(allDates).toContain('2026-05-29');
    // No weekend dates in grid
    for (const d of allDates) {
      const dt = new Date(d + 'T00:00:00Z');
      const dow = dt.getUTCDay();
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
    }
  });
});
