import { storedEconEventSchema, type StoredEconEvent } from './brief-schema';

/** ForexFactory's own weekly calendar, published as keyless JSON. This is
 * deliberately the same data the trader reads on forexfactory.com: the calendar
 * used to be synthesized by the LLM from web-search snippets, which put an FOMC
 * decision on the wrong day and moved GDP/PCE around by hours. Release timing is
 * structural data — it must come from a feed, not a language model.
 *
 * Only "this week" is published (Sun–Sat, rolling over Sunday); there is no
 * next-week or last-week variant, which suits a brief that covers the current
 * week. */
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

export class EconCalendarError extends Error {}

interface FeedEvent {
  title?: unknown;
  country?: unknown;
  /** ET wall clock carrying ET's own offset: '2026-07-30T08:30:00-04:00'. */
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
}

const IMPACTS: Record<string, StoredEconEvent['impact']> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
  holiday: 'low',
};

/** The literal wall clock in the feed's timestamp. The offset is always ET's
 * own, so the text before it is the ET date and time — no conversion needed to
 * recover them, and `Date` handles the UTC instant. */
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** ForexFactory files all-day and tentative entries at midnight. No US release
 * happens at 00:00 ET, so that hour means "no time", not "midnight". */
const ALL_DAY = '00:00';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toEvent(raw: FeedEvent): StoredEconEvent | null {
  const stamp = text(raw.date);
  const name = text(raw.title);
  if (!stamp || !name) return null;

  const parts = STAMP.exec(stamp);
  const instant = new Date(stamp);
  if (!parts || Number.isNaN(instant.getTime())) return null;

  const timed = parts[2] !== ALL_DAY;
  const candidate = {
    date: parts[1],
    timeEt: timed ? parts[2] : null,
    timeUtc: timed ? instant.toISOString() : null,
    name,
    expected: text(raw.forecast),
    previous: text(raw.previous),
    impact: IMPACTS[String(raw.impact).toLowerCase()] ?? 'low',
    note: null,
  };

  // The feed is third-party content the brief renders verbatim, so validate it
  // against the stored shape rather than trusting the mapping above.
  const parsed = storedEconEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface EconCalendarOptions {
  fetchFn?: typeof fetch;
  /** Feed currency code to keep — the brief only covers the US session. */
  country?: string;
}

/** This week's US economic releases, chronological, with date-only entries
 * sorted after timed ones on the same day. */
export async function fetchEconCalendar(
  opts: EconCalendarOptions = {},
): Promise<StoredEconEvent[]> {
  const { fetchFn = fetch, country = 'USD' } = opts;

  const res = await fetchFn(FEED_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new EconCalendarError(`Economic calendar feed failed (${res.status})`);

  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new EconCalendarError('Economic calendar feed returned no event array');

  const events = (body as FeedEvent[])
    .filter((e) => String(e?.country).toUpperCase() === country.toUpperCase())
    .map(toEvent)
    .filter((e): e is StoredEconEvent => e !== null);

  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.timeUtc && b.timeUtc) return a.timeUtc < b.timeUtc ? -1 : a.timeUtc > b.timeUtc ? 1 : 0;
    if (a.timeUtc) return -1;
    if (b.timeUtc) return 1;
    return 0;
  });
}
