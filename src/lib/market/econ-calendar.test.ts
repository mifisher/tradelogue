import { describe, it, expect, vi } from 'vitest';
import { fetchEconCalendar, EconCalendarError } from './econ-calendar';

const feed = (events: unknown[]) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => events }) as Response) as unknown as typeof fetch;

const event = (over: Record<string, unknown> = {}) => ({
  title: 'Core PCE Price Index m/m',
  country: 'USD',
  date: '2026-07-30T08:30:00-04:00',
  impact: 'High',
  forecast: '0.2%',
  previous: '0.3%',
  ...over,
});

describe('fetchEconCalendar', () => {
  it('keeps the ET wall clock and derives the UTC instant from the feed offset', async () => {
    const [pce] = await fetchEconCalendar({ fetchFn: feed([event()]) });
    expect(pce).toMatchObject({
      date: '2026-07-30',
      timeEt: '08:30',
      timeUtc: '2026-07-30T12:30:00.000Z',
      name: 'Core PCE Price Index m/m',
      expected: '0.2%',
      previous: '0.3%',
      impact: 'high',
    });
  });

  it('honours the ET offset in winter (EST = UTC-5)', async () => {
    const [cpi] = await fetchEconCalendar({
      fetchFn: feed([event({ title: 'CPI m/m', date: '2026-01-15T08:30:00-05:00' })]),
    });
    expect(cpi.date).toBe('2026-01-15');
    expect(cpi.timeUtc).toBe('2026-01-15T13:30:00.000Z');
  });

  it('drops non-US events', async () => {
    const events = await fetchEconCalendar({
      fetchFn: feed([event({ country: 'EUR', title: 'German ifo' }), event()]),
    });
    expect(events.map((e) => e.name)).toEqual(['Core PCE Price Index m/m']);
  });

  it('treats a midnight stamp as an all-day/tentative entry', async () => {
    const [holiday] = await fetchEconCalendar({
      fetchFn: feed([event({ title: 'Bank Holiday', impact: 'Holiday', date: '2026-07-03T00:00:00-04:00' })]),
    });
    expect(holiday.timeEt).toBeNull();
    expect(holiday.timeUtc).toBeNull();
    expect(holiday.impact).toBe('low');
  });

  it('reads blank forecast/previous strings as absent', async () => {
    const [speech] = await fetchEconCalendar({
      fetchFn: feed([event({ title: 'FOMC Statement', forecast: '', previous: '' })]),
    });
    expect(speech.expected).toBeNull();
    expect(speech.previous).toBeNull();
  });

  it('sorts by day then time, with all-day entries last', async () => {
    const events = await fetchEconCalendar({
      fetchFn: feed([
        event({ title: 'Fri Chicago PMI', date: '2026-07-31T09:45:00-04:00' }),
        event({ title: 'Thu all day', date: '2026-07-30T00:00:00-04:00' }),
        event({ title: 'Thu GDP', date: '2026-07-30T08:30:00-04:00' }),
        event({ title: 'Wed FOMC', date: '2026-07-29T14:00:00-04:00' }),
      ]),
    });
    expect(events.map((e) => e.name)).toEqual(['Wed FOMC', 'Thu GDP', 'Thu all day', 'Fri Chicago PMI']);
  });

  it('skips malformed rows rather than failing the fetch', async () => {
    const events = await fetchEconCalendar({
      fetchFn: feed([
        event({ date: 'sometime next week' }),
        event({ title: '' }),
        null,
        event({ title: 'Unemployment Claims' }),
      ]),
    });
    expect(events.map((e) => e.name)).toEqual(['Unemployment Claims']);
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503 }) as Response) as unknown as typeof fetch;
    await expect(fetchEconCalendar({ fetchFn })).rejects.toBeInstanceOf(EconCalendarError);
  });

  it('throws when the feed body is not an event array', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(fetchEconCalendar({ fetchFn })).rejects.toBeInstanceOf(EconCalendarError);
  });
});
