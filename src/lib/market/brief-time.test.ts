import { describe, it, expect } from 'vitest';
import { earningsWindow, groupEconByDay } from './brief-time';
import type { StoredEconEvent } from './brief-schema';

describe('earningsWindow', () => {
  it('runs previous trading day, today, then the next three', () => {
    // Thursday 2026-07-23 → Wed, [Thu], Fri, Mon, Tue (weekend skipped)
    expect(earningsWindow('2026-07-23')).toEqual([
      '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-27', '2026-07-28',
    ]);
  });

  it('reaches back over the weekend on a Monday', () => {
    // Monday 2026-07-20 → previous trading day is Friday the 17th
    expect(earningsWindow('2026-07-20')).toEqual([
      '2026-07-17', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23',
    ]);
  });

  it('keeps today in the window even when it is a weekend', () => {
    // Saturday 2026-07-25 → Fri, [Sat], Mon, Tue, Wed. The Saturday column
    // renders empty rather than silently shifting the window.
    const window = earningsWindow('2026-07-25');
    expect(window).toEqual(['2026-07-24', '2026-07-25', '2026-07-27', '2026-07-28', '2026-07-29']);
    expect(window[1]).toBe('2026-07-25');
  });

  it('always spans five ascending sessions with today second', () => {
    for (const day of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']) {
      const window = earningsWindow(day);
      expect(window).toHaveLength(5);
      expect(window[1]).toBe(day);
      expect([...window].sort()).toEqual(window);
    }
  });
});

const ev = (date: string, timeUtc: string | null, name: string): StoredEconEvent => ({
  date, timeEt: null, timeUtc, name, expected: null, previous: null, impact: 'medium', note: null,
});

describe('groupEconByDay', () => {
  it('buckets by ascending day, chronological within a day, all-day entries last', () => {
    const events = [
      ev('2026-07-22', '2026-07-22T12:30:00.000Z', 'Wed data'),
      ev('2026-07-20', null, 'Mon all day'),
      ev('2026-07-20', '2026-07-20T12:30:00.000Z', 'Mon 8:30'),
      ev('2026-07-20', '2026-07-20T14:00:00.000Z', 'Mon 10:00'),
    ];
    expect(groupEconByDay(events)).toEqual([
      { date: '2026-07-20', events: [events[2], events[3], events[1]] },
      { date: '2026-07-22', events: [events[0]] },
    ]);
  });

  it('keeps already-released days — Thursday still needs Wednesday\'s FOMC', () => {
    const events = [
      ev('2026-07-22', '2026-07-22T18:00:00.000Z', 'FOMC'),
      ev('2026-07-23', '2026-07-23T12:30:00.000Z', 'GDP'),
    ];
    expect(groupEconByDay(events).map((d) => d.date)).toEqual(['2026-07-22', '2026-07-23']);
  });

  it('returns no groups for an empty week', () => {
    expect(groupEconByDay([])).toEqual([]);
  });
});
