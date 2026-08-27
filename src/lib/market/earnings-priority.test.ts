import { describe, it, expect } from 'vitest';
import { earningsPriority, isPriorityName, tradedSet } from './earnings-priority';

describe('earningsPriority', () => {
  const traded = tradedSet(['aapl', 'schw', 'nvda', 'alk', 'arm']);

  it('marks a Mag 7 name blue (watch) even when it was also traded', () => {
    // The trader owns AAPL and NVDA, but they still read as mega caps.
    expect(earningsPriority('AAPL', traded)).toBe('watch');
    expect(earningsPriority('NVDA', traded)).toBe('watch');
  });

  it('marks a hand-picked watchlist name blue whether or not it was traded', () => {
    expect(earningsPriority('UPS', new Set())).toBe('watch'); // not traded
    expect(earningsPriority('RDDT', new Set())).toBe('watch'); // not traded
    expect(earningsPriority('ARM', traded)).toBe('watch'); // also traded → watch still wins
  });

  it('marks the memory names blue', () => {
    expect(earningsPriority('WDC', new Set())).toBe('watch');
    expect(earningsPriority('SNDK', new Set())).toBe('watch');
    expect(earningsPriority('MU', new Set())).toBe('watch');
  });

  it('keeps PLTR visible as a trader watchlist name', () => {
    expect(earningsPriority('PLTR', new Set())).toBe('watch');
  });

  // Both are notable enough to watch but too small to survive the card's
  // market-cap ranking on their own — QBTS is a ~$4B quantum name and OSCR a
  // ~$10B insurer, so a busy session buries them behind the mega caps.
  it('keeps the notable small caps the cap ranking would drop', () => {
    expect(earningsPriority('QBTS', new Set())).toBe('watch');
    expect(earningsPriority('OSCR', new Set())).toBe('watch');
  });

  it('marks a traded non-watchlist name green', () => {
    expect(earningsPriority('SCHW', traded)).toBe('traded');
    expect(earningsPriority('ALK', traded)).toBe('traded');
  });

  it('treats GOOG and GOOGL as watchlist (Alphabet)', () => {
    expect(earningsPriority('GOOG', new Set())).toBe('watch');
    expect(earningsPriority('GOOGL', new Set())).toBe('watch');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(earningsPriority('  schw ', traded)).toBe('traded');
    expect(earningsPriority('tsla', new Set())).toBe('watch');
    expect(earningsPriority('rddt', new Set())).toBe('watch');
  });

  it('returns null for a name that is neither', () => {
    expect(earningsPriority('TECK', traded)).toBeNull();
  });
});

describe('isPriorityName', () => {
  const traded = tradedSet(['schw']);

  it('is true for traded, Mag 7, and watchlist names, false otherwise', () => {
    expect(isPriorityName('SCHW', traded)).toBe(true); // traded
    expect(isPriorityName('MSFT', traded)).toBe(true); // mag 7
    expect(isPriorityName('RDDT', traded)).toBe(true); // watchlist extra
    expect(isPriorityName('TECK', traded)).toBe(false);
  });
});
