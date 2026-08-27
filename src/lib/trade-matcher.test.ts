import { describe, it, expect } from 'vitest';
import { findComboMatch, combinations } from './trade-matcher';

// ---------------------------------------------------------------------------
// combinations() helper
// ---------------------------------------------------------------------------

describe('combinations', () => {
  it('returns empty array for size 0', () => {
    const result = [...combinations([1, 2, 3], 0)];
    expect(result).toEqual([[]]);
  });

  it('returns singletons for size 1', () => {
    const result = [...combinations(['a', 'b', 'c'], 1)];
    expect(result).toEqual([['a'], ['b'], ['c']]);
  });

  it('returns correct pairs for size 2 from 3 elements (3 combos)', () => {
    const result = [...combinations([1, 2, 3], 2)];
    expect(result).toHaveLength(3);
    expect(result).toContainEqual([1, 2]);
    expect(result).toContainEqual([1, 3]);
    expect(result).toContainEqual([2, 3]);
  });

  it('returns one triple from 3 elements at size 3', () => {
    const result = [...combinations([1, 2, 3], 3)];
    expect(result).toEqual([[1, 2, 3]]);
  });

  it('returns empty when size > array length', () => {
    const result = [...combinations([1, 2], 3)];
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findComboMatch()
// ---------------------------------------------------------------------------

describe('findComboMatch', () => {
  // --- Pair match --------------------------------------------------------
  it('matches a pair of trades whose sum equals the journal pnl exactly', () => {
    const candidates = [
      { firstExecId: 'exec-a', pnl: -200 },
      { firstExecId: 'exec-b', pnl: -274 },
      { firstExecId: 'exec-c', pnl: -50 },
    ];
    // -200 + -274 = -474 (NVDA ×2 scenario)
    const result = findComboMatch(-474, candidates);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result).toContain('exec-a');
    expect(result).toContain('exec-b');
  });

  // --- Triple match -------------------------------------------------------
  it('matches a triple when no pair sums within tolerance', () => {
    const candidates = [
      { firstExecId: 'exec-1', pnl: -100 },
      { firstExecId: 'exec-2', pnl: -150 },
      { firstExecId: 'exec-3', pnl: -200 },
    ];
    // -100 + -150 + -200 = -450; no pair sums to -450
    const result = findComboMatch(-450, candidates);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result).toContain('exec-1');
    expect(result).toContain('exec-2');
    expect(result).toContain('exec-3');
  });

  // --- Prefers smaller combo over larger ----------------------------------
  it('prefers a pair match over a triple match when both are within tolerance', () => {
    // pair: exec-a + exec-b = -400 (diff 0 from -400)
    // triple: exec-a + exec-b + exec-c = -450 — not within 25 of -400
    // So make a scenario where both a pair AND a triple match:
    // journalPnl = -400
    // pair (exec-a + exec-b) = -390  → diff 10 ✓
    // triple (exec-a + exec-b + exec-c) = -400 → diff 0 ✓
    // Expect pair to win (smaller size)
    const candidates = [
      { firstExecId: 'exec-a', pnl: -190 },
      { firstExecId: 'exec-b', pnl: -200 },
      { firstExecId: 'exec-c', pnl: -10 },
    ];
    const result = findComboMatch(-400, candidates);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2); // pair wins over triple
    expect(result).toContain('exec-a');
    expect(result).toContain('exec-b');
  });

  // --- Prefers closer diff within same size -------------------------------
  it('among same-size combos, picks the one with smallest |diff|', () => {
    // journalPnl = -300
    // pair A: exec-1 + exec-2 = -295 → diff 5
    // pair B: exec-1 + exec-3 = -280 → diff 20
    // pair C: exec-2 + exec-3 = -285 → diff 15
    // Expect pair A (exec-1 + exec-2) to win
    const candidates = [
      { firstExecId: 'exec-1', pnl: -100 },
      { firstExecId: 'exec-2', pnl: -195 },
      { firstExecId: 'exec-3', pnl: -180 },
    ];
    const result = findComboMatch(-300, candidates);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result).toContain('exec-1');
    expect(result).toContain('exec-2');
  });

  // --- Returns null when nothing within tolerance -------------------------
  it('returns null when no combination is within tolerance', () => {
    const candidates = [
      { firstExecId: 'exec-a', pnl: -100 },
      { firstExecId: 'exec-b', pnl: -100 },
    ];
    // sum = -200, journalPnl = -400, diff = 200 > 25
    const result = findComboMatch(-400, candidates);
    expect(result).toBeNull();
  });

  // --- Tolerance boundary ------------------------------------------------
  it('matches when diff equals tolerance exactly', () => {
    const candidates = [
      { firstExecId: 'exec-a', pnl: -100 },
      { firstExecId: 'exec-b', pnl: -175 }, // sum = -275, journalPnl = -300, diff = 25 ✓
    ];
    const result = findComboMatch(-300, candidates, 25);
    expect(result).not.toBeNull();
  });

  it('rejects when diff is just over tolerance', () => {
    const candidates = [
      { firstExecId: 'exec-a', pnl: -100 },
      { firstExecId: 'exec-b', pnl: -174 }, // sum = -274, journalPnl = -300, diff = 26 ✗
    ];
    const result = findComboMatch(-300, candidates, 25);
    expect(result).toBeNull();
  });

  // --- Null pnl candidate treated as 0 -----------------------------------
  it('treats null pnl as 0 when summing', () => {
    const candidates = [
      { firstExecId: 'exec-a', pnl: null },
      { firstExecId: 'exec-b', pnl: -474 }, // 0 + -474 = -474
    ];
    const result = findComboMatch(-474, candidates);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
  });

  // --- maxSize capped at 4 by default ------------------------------------
  it('does not try combos larger than maxSize', () => {
    // Five candidates whose only matching combo is all 5 — should return null
    const candidates = [
      { firstExecId: 'e1', pnl: -100 },
      { firstExecId: 'e2', pnl: -100 },
      { firstExecId: 'e3', pnl: -100 },
      { firstExecId: 'e4', pnl: -100 },
      { firstExecId: 'e5', pnl: -100 },
    ];
    // sum of all 5 = -500; no combo of ≤4 sums to -500 (max 4-combo = -400)
    const result = findComboMatch(-500, candidates); // default maxSize=4
    expect(result).toBeNull();
  });

  // --- Custom tolerance --------------------------------------------------
  it('respects a custom tolerance of 0 (exact match only)', () => {
    const candidates = [
      { firstExecId: 'exec-a', pnl: -200 },
      { firstExecId: 'exec-b', pnl: -273 }, // sum = -473, diff=1 from -474
    ];
    expect(findComboMatch(-474, candidates, 0)).toBeNull();
    // Adjust to exact
    const exact = [
      { firstExecId: 'exec-a', pnl: -200 },
      { firstExecId: 'exec-b', pnl: -274 }, // sum = -474, diff=0 ✓
    ];
    expect(findComboMatch(-474, exact, 0)).not.toBeNull();
  });

  // --- Returns null with 0 or 1 candidate (no combos of size 2) ---------
  it('returns null when there are fewer than 2 candidates', () => {
    expect(findComboMatch(-300, [])).toBeNull();
    expect(findComboMatch(-300, [{ firstExecId: 'only', pnl: -300 }])).toBeNull();
  });
});
