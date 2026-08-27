import { describe, it, expect } from 'vitest';
import { briefContentSchema, normalizeTimeEt, storedEconEventSchema } from './brief-schema';

const valid = {
  overview: 'Risk-off tape; semis lead lower.',
  tradingPosture: 'Do not chase the first 5-minute candle.',
  topStories: [
    { headline: 'Chip selloff deepens', summary: 'Semis drag Nasdaq futures down 2%.', sourceUrl: 'https://example.com/a' },
  ],
  earningsNotes: [
    { ticker: 'TRV', watchItem: 'Cat losses, combined ratio' },
  ],
  stocksInPlay: [
    { ticker: 'NFLX', catalyst: 'Post-earnings selloff', signal: 'Down ~10% premarket', approach: 'Only trade after first reclaim/fail structure.' },
  ],
  redditNotes: [
    { ticker: 'NVDA', note: 'Split between dip-buy and valuation reset.' },
  ],
  redditDivergence: 'Retail is buying the semis dip the tape is still selling.',
  rulesFocus: [
    { ruleNumber: 15, title: 'Chop-day circuit breaker', whyToday: 'Headline-driven tape with VIX bid.' },
  ],
};

describe('reddit notes', () => {
  // Same contract as earningsNotes: the rows are built in code from real
  // mention counts, and the model may only annotate them. A malformed note is
  // decoration on real data, so it is dropped rather than failing the brief.
  it('drops a malformed note instead of rejecting the brief', () => {
    const parsed = briefContentSchema.parse({
      ...valid,
      redditNotes: [
        { ticker: 'NVDA', note: 'real' },
        { ticker: '', note: 'no ticker' },
        { ticker: 'AMD' },
        'nonsense',
      ],
    });
    expect(parsed.redditNotes).toEqual([{ ticker: 'NVDA', note: 'real' }]);
  });

  it('defaults notes to an empty list when the model omits them', () => {
    const { redditNotes, ...withoutNotes } = valid;
    void redditNotes;
    expect(briefContentSchema.parse(withoutNotes).redditNotes).toEqual([]);
  });

  // The divergence line is prose the model owns, but an absent one must not
  // discard a brief that is otherwise complete.
  it('treats an omitted divergence line as empty', () => {
    const { redditDivergence, ...withoutDivergence } = valid;
    void redditDivergence;
    expect(briefContentSchema.parse(withoutDivergence).redditDivergence).toBe('');
  });
});

describe('omitted nullable fields', () => {
  // Models drop optional-looking keys rather than emitting null. A bare
  // .nullable() rejected that and discarded the entire brief.
  const minimal = {
    overview: 'o',
    tradingPosture: 'p',
    topStories: [{ headline: 'h', summary: 's' }],
    stocksInPlay: [],
    rulesFocus: [],
    // earningsNotes omitted entirely — must default to []
  };

  it('accepts a payload that omits every nullable key', () => {
    expect(() => briefContentSchema.parse(minimal)).not.toThrow();
  });

  it('normalizes each omitted key to null', () => {
    const parsed = briefContentSchema.parse(minimal);
    expect(parsed.topStories[0].sourceUrl).toBeNull();
  });

  it('defaults an omitted earningsNotes to an empty array', () => {
    expect(briefContentSchema.parse(minimal).earningsNotes).toEqual([]);
  });
});

describe('earningsNotes tolerance', () => {
  const withNotes = (notes: unknown) => briefContentSchema.parse({ ...valid, earningsNotes: notes });

  it('keeps well-formed notes', () => {
    expect(withNotes([{ ticker: 'GM', watchItem: 'China demand' }]).earningsNotes).toEqual([
      { ticker: 'GM', watchItem: 'China demand' },
    ]);
  });

  it('drops malformed notes instead of failing the brief', () => {
    const notes = [
      { ticker: 'GM', watchItem: 'China demand' },
      { ticker: 'BAD' }, // missing watchItem
      { watchItem: 'no ticker' },
      'garbage',
      null,
    ];
    expect(withNotes(notes).earningsNotes).toEqual([{ ticker: 'GM', watchItem: 'China demand' }]);
  });

  it('treats a non-array as empty', () => {
    expect(withNotes('nope').earningsNotes).toEqual([]);
  });
});

describe('normalizeTimeEt', () => {
  it('zero-pads the unpadded hour that used to fail the whole brief', () => {
    expect(normalizeTimeEt('8:30')).toBe('08:30');
  });

  it('converts 12-hour clock times to 24h', () => {
    expect(normalizeTimeEt('8:30 AM')).toBe('08:30');
    expect(normalizeTimeEt('1:00 PM')).toBe('13:00');
    expect(normalizeTimeEt('12:00 AM')).toBe('00:00');
    expect(normalizeTimeEt('12:30 PM')).toBe('12:30');
  });

  it('tolerates trailing zone labels and stray whitespace', () => {
    expect(normalizeTimeEt('  8:30 AM ET')).toBe('08:30');
    expect(normalizeTimeEt('14:00 ET')).toBe('14:00');
  });

  it('passes already-canonical values through', () => {
    expect(normalizeTimeEt('08:30')).toBe('08:30');
    expect(normalizeTimeEt('23:59')).toBe('23:59');
  });

  it('returns null for missing or unparseable values instead of throwing', () => {
    for (const bad of [null, undefined, '', 'TBD', 'tentative', '25:00', '8:75', 42]) {
      expect(normalizeTimeEt(bad)).toBeNull();
    }
  });
});

describe('briefContentSchema', () => {
  it('accepts a complete brief', () => {
    expect(briefContentSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a brief with no top stories', () => {
    expect(() => briefContentSchema.parse({ ...valid, topStories: [] })).toThrow();
  });

  // The econ calendar is no longer part of the model's contract — it comes
  // from the release-schedule feed, so a hallucinated event has nowhere to enter.
  it('ignores an econCalendar the model returns anyway', () => {
    const parsed = briefContentSchema.parse({ ...valid, econCalendar: [{ name: 'Invented CPI' }] });
    expect(parsed).not.toHaveProperty('econCalendar');
  });
});

describe('storedEconEventSchema', () => {
  const event = {
    date: '2026-07-30', timeEt: '08:30', timeUtc: '2026-07-30T12:30:00.000Z',
    name: 'Core PCE Price Index m/m', expected: '0.2%', previous: '0.3%',
    impact: 'high', note: null,
  };

  it('accepts a feed event', () => {
    expect(storedEconEventSchema.parse(event)).toEqual(event);
  });

  it('rejects bad impact values', () => {
    expect(() => storedEconEventSchema.parse({ ...event, impact: 'huge' })).toThrow();
  });

  it('rejects a malformed date', () => {
    expect(() => storedEconEventSchema.parse({ ...event, date: 'next Thursday' })).toThrow();
  });

  it('degrades an unparseable timeEt to null (all-day) rather than throwing', () => {
    expect(storedEconEventSchema.parse({ ...event, timeEt: 'TBD' }).timeEt).toBeNull();
  });
});
