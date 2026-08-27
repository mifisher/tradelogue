import { z } from 'zod';

/** What the synthesis LLM must return. Numbers for the asset cards do NOT
 * live here — quotes are pure API data (see BriefQuotes below). */
/** A nullable field the model may simply omit rather than emit as null. Treat
 * a missing key as null: dropping one optional detail must not discard the
 * whole brief, which is what a bare .nullable() did. */
const omittableString = () => z.string().nullish().transform((v) => v ?? null);

export const topStorySchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  sourceUrl: omittableString(),
});

const TIME_ET = /^\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i;

/** Models write ET times loosely — "8:30", "8:30 AM", "1:00 PM ET" — and a
 * single unpadded hour used to fail the whole brief. Normalize to 24h HH:mm;
 * anything unparseable becomes null, which the schema already means as
 * date-only/tentative. Losing one timestamp beats losing the entire brief. */
export function normalizeTimeEt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = TIME_ET.exec(value);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;

  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** One economic release. Not part of the model's output contract — release
 * dates and times come from the ForexFactory feed (see econ-calendar.ts), which
 * is why this shape is validated at the feed boundary instead. */
export const econEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // event date in ET
  // ET wall clock, null = date-only/tentative
  timeEt: z.preprocess(normalizeTimeEt, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()),
  name: z.string().min(1),
  expected: omittableString(),
  previous: omittableString(),
  impact: z.enum(['high', 'medium', 'low']),
  note: omittableString(),
});

/** The stored/rendered form: the feed's timestamp already fixes the instant, so
 * timeUtc rides along rather than being recomputed at render time. */
export const storedEconEventSchema = econEventSchema.extend({
  timeUtc: z.string().nullable(),
});

/** The stored/rendered earnings row. Built in code from the ranked Finnhub
 * calendar (see buildEarnings), not returned by the model — so its length no
 * longer depends on how terse the model is. watchItem may be empty when the
 * model had nothing to add for that name. */
export const earningsItemSchema = z.object({
  company: z.string().min(1),
  ticker: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timing: z.enum(['BMO', 'AMC', 'unknown']),
  epsEstimate: omittableString(),
  watchItem: z.string(),
});

/** The model's only earnings contribution: a one-line "what to watch" for
 * whichever reporters it has something to say about. */
export const earningsNoteSchema = z.object({
  ticker: z.string().min(1),
  watchItem: z.string().min(1),
});

/** Notes are pure decoration over a deterministic list, so a malformed note
 * must never fail the brief — filter junk out before validating rather than
 * rejecting the whole array. */
const earningsNotesField = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter(
          (n): n is { ticker: string; watchItem: string } =>
            !!n &&
            typeof n === 'object' &&
            typeof (n as { ticker?: unknown }).ticker === 'string' &&
            (n as { ticker: string }).ticker.trim().length > 0 &&
            typeof (n as { watchItem?: unknown }).watchItem === 'string' &&
            (n as { watchItem: string }).watchItem.trim().length > 0,
        )
      : [],
  z.array(earningsNoteSchema),
);

export const stockInPlaySchema = z.object({
  ticker: z.string().min(1),
  catalyst: z.string().min(1),
  signal: z.string().min(1),
  approach: z.string().min(1),
});

/** Real market data attached to a pick after synthesis. The model has no price
 * feed, so any level it writes is guesswork — these are the numbers the trader
 * can actually check its prose against. */
export const stockQuoteSchema = z.object({
  price: z.number(),
  changePct: z.number(),
  prevClose: z.number(),
  /** Session high/low, null before the open. */
  dayHigh: z.number().nullable(),
  dayLow: z.number().nullable(),
});

/** One trending ticker as rendered. Built in code from real mention counts —
 * the model used to write this section freehand from Tavily results that were
 * mostly Reddit landing pages, and invented a $30 price target for a
 * four-figure stock. Now it may only annotate rows it cannot fabricate. */
export const storedRedditItemSchema = z.object({
  ticker: z.string().min(1),
  name: z.string().nullable(),
  subreddit: z.string(),
  mentions: z.number(),
  mentions24hAgo: z.number().nullable(),
  /** Mentions over yesterday's; null when there is no baseline. */
  momentum: z.number().nullable(),
  sentiment: z.enum(['bullish', 'bearish', 'mixed']).nullable(),
  sentimentScore: z.number().nullable(),
  inTodaysBrief: z.boolean(),
  /** The model's one-line read, empty when it had nothing to add. */
  note: z.string(),
});

/** The model's only per-ticker Reddit contribution. */
export const redditNoteSchema = z.object({
  ticker: z.string().min(1),
  note: z.string().min(1),
});

/** Notes decorate rows that are real either way, so junk is filtered out rather
 * than failing the brief — same contract as earningsNotes. */
const redditNotesField = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter(
          (n): n is { ticker: string; note: string } =>
            !!n &&
            typeof n === 'object' &&
            typeof (n as { ticker?: unknown }).ticker === 'string' &&
            (n as { ticker: string }).ticker.trim().length > 0 &&
            typeof (n as { note?: unknown }).note === 'string' &&
            (n as { note: string }).note.trim().length > 0,
        )
      : [],
  z.array(redditNoteSchema),
);

export const ruleFocusSchema = z.object({
  ruleNumber: z.number().int(),
  title: z.string().min(1),
  whyToday: z.string().min(1),
});

export const briefContentSchema = z.object({
  overview: z.string().min(1),
  tradingPosture: z.string().min(1),
  topStories: z.array(topStorySchema).min(1),
  earningsNotes: earningsNotesField,
  stocksInPlay: z.array(stockInPlaySchema),
  redditNotes: redditNotesField,
  /** One line on where retail and the tape disagree. Prose the model owns, but
   * an absent one must not discard an otherwise complete brief. */
  redditDivergence: z.string().nullish().transform((v) => v ?? ''),
  rulesFocus: z.array(ruleFocusSchema),
});

export type BriefContent = z.infer<typeof briefContentSchema>;
export type EconEvent = z.infer<typeof econEventSchema>;
export type EarningsItem = z.infer<typeof earningsItemSchema>;
export type StockInPlay = z.infer<typeof stockInPlaySchema>;
export type EarningsNote = z.infer<typeof earningsNoteSchema>;

/** Stored form: the econ calendar comes from the ForexFactory feed and the
 * earnings list from the ranked Finnhub calendar — neither is model output, so
 * both are joined onto the content after synthesis. */
export type StoredEconEvent = z.infer<typeof storedEconEventSchema>;
export type StockQuote = z.infer<typeof stockQuoteSchema>;
export type RedditNote = z.infer<typeof redditNoteSchema>;
export type StoredRedditItem = z.infer<typeof storedRedditItemSchema>;
/** A pick as rendered: the model's prose plus a real quote (null when Finnhub
 * was unreachable — an unresolvable ticker is dropped, not stored). */
export type StoredStockInPlay = z.infer<typeof stockInPlaySchema> & { quote: StockQuote | null };
export type StoredBriefContent = Omit<
  BriefContent,
  'earningsNotes' | 'stocksInPlay' | 'redditNotes'
> & {
  econCalendar: StoredEconEvent[];
  earnings: EarningsItem[];
  stocksInPlay: StoredStockInPlay[];
  /** Real mention data joined with the model's notes. */
  redditScan: StoredRedditItem[];
};

/** Pure API data for the dashboard cards — never LLM output. */
export interface AssetQuote {
  symbol: string;       // 'SPY' | 'QQQ' | 'VIX' | 'BTC'
  label: string;        // 'S&P 500 (SPY)'
  value: number;
  change: number;
  changePct: number;
  sparkline: number[];  // daily closes, oldest → newest (may be empty)
}

export interface BriefQuotes {
  assets: AssetQuote[];
  asOfUtc: string;
}

export interface BriefSourceLink {
  url: string;
  title: string;
}
