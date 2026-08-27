import { Card } from '@/components/card';
import { EventTime } from '@/components/event-time';
import { BriefRefreshButton } from '@/components/brief-refresh-button';
import { getLatestMarketBrief, getMarketBriefConfig } from '@/lib/market-brief-actions';
import { underlyings } from '@/lib/queries';
import { EarningsWeek } from '@/components/earnings-week';
import { EconCalendar } from '@/components/econ-calendar';
import { earningsWindow } from '@/lib/market/brief-time';
import { sessionDate } from '@/lib/daily-pnl';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${n.toFixed(2)}`;

/** Real quote next to the model's prose. The model has no price feed, so any
 * level it writes is guesswork — these are the numbers to check it against. */
/** Mixed reads as neither side, so it stays muted rather than borrowing the
 * green/red the P&L columns use for direction. */
function sentimentTone(sentiment: 'bullish' | 'bearish' | 'mixed'): string {
  if (sentiment === 'bullish') return 'text-gain';
  if (sentiment === 'bearish') return 'text-loss';
  return 'text-stone';
}

function QuoteStrip({ quote }: { quote: import('@/lib/market/brief-schema').StockQuote }) {
  const up = quote.changePct >= 0;
  return (
    <span className="flex items-baseline gap-2 text-[13px] tabular">
      <span className="text-ondark font-semibold">{money(quote.price)}</span>
      <span className={up ? 'text-gain' : 'text-loss'}>
        {up ? '+' : ''}{quote.changePct.toFixed(2)}%
      </span>
      <span className="text-stone">prev {money(quote.prevClose)}</span>
      {quote.dayLow != null && quote.dayHigh != null && (
        <span className="text-stone">range {money(quote.dayLow)}–{money(quote.dayHigh)}</span>
      )}
    </span>
  );
}

function fmtDay(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** Story/source URLs originate from LLM synthesis over untrusted web-search
 * content. Only surface http(s) links so a hallucinated or injected
 * `javascript:`/`data:` scheme can never reach an anchor href. */
function safeHttpUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export default async function MarketPage() {
  const [{ row, latestFailure }, config, tradedTickers] = await Promise.all([
    getLatestMarketBrief(),
    getMarketBriefConfig(),
    underlyings().catch(() => [] as string[]),
  ]);

  if (!config.configured) {
    return (
      <main className="max-w-[1200px] mx-auto px-6 py-16">
        <h1 className="font-display text-3xl text-ondark mb-6">Market</h1>
        <Card title="Market brief not configured">
          <p className="text-sm text-mute">
            Add {config.missing.join(', ')} to your .env to enable the daily market brief.
          </p>
        </Card>
      </main>
    );
  }

  const todayPt = sessionDate(new Date());
  const brief = row?.brief ?? null;
  // Anchor the earnings columns to the brief's own session so they line up with
  // the data it gathered; the "Today" highlight still tracks the real date, so a
  // stale brief simply highlights nothing rather than mislabelling a past day.
  const briefToday = row?.briefDate ?? todayPt;
  // Briefs written before the Reddit section moved to real mention counts stored
  // `{topic, summary, confidence}` rows. Those carry no ticker, so they would
  // render as a row of blanks — skip them and let the card read as empty.
  const redditRows = (brief?.redditScan ?? []).filter((r) => typeof r?.ticker === 'string' && r.ticker);

  return (
    <main className="max-w-[1200px] mx-auto px-6 pb-24">
      <section className="py-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ondark">Market</h1>
          {row && (
            <p className="text-sm text-mute mt-2">
              Brief for {fmtDay(row.briefDate)} · generated{' '}
              <EventTime utc={row.generatedAt.toISOString()} mode="datetime" /> ·{' '}
              {row.trigger} · {row.model}
              {row.status === 'partial' && (
                <span className="text-loss"> · some sources unavailable</span>
              )}
            </p>
          )}
        </div>
        <BriefRefreshButton label={row ? 'Refresh brief' : "Generate today's brief"} />
      </section>

      {latestFailure && (
        <Card className="mb-8">
          <p className="text-loss text-sm">
            Latest generation attempt failed: {latestFailure}. Showing the previous brief.
          </p>
        </Card>
      )}

      {!row || !brief ? (
        <Card>
          <p className="text-sm text-mute">
            No brief yet. Generate one above — or schedule it to run each morning (see the README).
          </p>
        </Card>
      ) : (
        <>
          <Card title="Market overview" className="mb-8">
            <p className="text-ondark text-sm leading-relaxed whitespace-pre-line">{brief.overview}</p>
            <p className="mt-4 pt-4 border-t border-divider text-sm text-mute">
              <span className="text-stone uppercase tracking-wide text-[13px] mr-2">Posture</span>
              {brief.tradingPosture}
            </p>
          </Card>

          <Card title="Top stories" className="mb-8">
            <div className="divide-y divide-divider">
              {brief.topStories.map((s, i) => {
                const href = safeHttpUrl(s.sourceUrl);
                return (
                  <div key={i} className="py-4 first:pt-0 last:pb-0">
                    <h3 className="text-ondark text-sm font-semibold">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                          {s.headline} ↗
                        </a>
                      ) : (
                        s.headline
                      )}
                    </h3>
                    <p className="text-sm text-mute mt-1">{s.summary}</p>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Economic calendar" className="mb-8">
            <EconCalendar events={brief.econCalendar} todayPt={todayPt} />
          </Card>

          <Card title="Earnings in focus" className="mb-8">
            {brief.earnings.length === 0 ? (
              <p className="text-sm text-mute">No major earnings surfaced.</p>
            ) : (
              <EarningsWeek
                window={earningsWindow(briefToday)}
                earnings={brief.earnings}
                todayPt={todayPt}
                tradedTickers={tradedTickers}
              />
            )}
          </Card>

          <Card title="Stocks in play" className="mb-8">
            {brief.stocksInPlay.length === 0 ? (
              <p className="text-sm text-mute">No clean catalysts surfaced.</p>
            ) : (
              <div className="divide-y divide-divider">
                {brief.stocksInPlay.map((s, i) => (
                  <div key={i} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="bg-deep rounded-full px-2.5 py-0.5 text-[13px] text-ondark font-semibold tabular">{s.ticker}</span>
                      {s.quote && <QuoteStrip quote={s.quote} />}
                      <span className="text-sm text-stone">{s.signal}</span>
                    </div>
                    <p className="text-sm text-mute mt-2">{s.catalyst}</p>
                    <p className="text-sm text-ondark mt-1">
                      <span className="text-stone uppercase tracking-wide text-[13px] mr-2">Approach</span>
                      {s.approach}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Reddit sentiment" className="mb-8">
            {redditRows.length === 0 ? (
              <p className="text-sm text-mute">No Reddit signal gathered.</p>
            ) : (
              <>
                <div className="divide-y divide-divider">
                  {redditRows.map((r, i) => (
                    <div key={i} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="bg-deep rounded-full px-2.5 py-0.5 text-[13px] text-ondark font-semibold tabular">{r.ticker}</span>
                        {r.sentiment && (
                          <span className={`text-[13px] uppercase tracking-wide ${sentimentTone(r.sentiment)}`}>
                            {r.sentiment}
                          </span>
                        )}
                        <span className="text-sm text-stone tabular">
                          {r.mentions} mentions
                          {r.mentions24hAgo != null && <> · {r.mentions24hAgo} yesterday</>}
                          {r.momentum != null && r.momentum >= 2 && (
                            <span className="text-gain"> · {r.momentum.toFixed(1)}× spike</span>
                          )}
                        </span>
                        <span className="text-[13px] text-stone">r/{r.subreddit}</span>
                        {r.inTodaysBrief && (
                          <span className="text-[13px] text-ondark uppercase tracking-wide">on today&rsquo;s brief</span>
                        )}
                      </div>
                      {r.note && <p className="text-sm text-mute mt-2">{r.note}</p>}
                    </div>
                  ))}
                </div>
                {brief.redditDivergence && (
                  <p className="mt-4 pt-4 border-t border-divider text-sm text-mute">
                    <span className="text-stone uppercase tracking-wide text-[13px] mr-2">Divergence</span>
                    {brief.redditDivergence}
                  </p>
                )}
              </>
            )}
          </Card>

          <Card title="Rules focus for today" className="mb-8">
            {brief.rulesFocus.length === 0 ? (
              <p className="text-sm text-mute">No rule focus surfaced.</p>
            ) : (
              <div className="divide-y divide-divider">
                {brief.rulesFocus.map((r, i) => (
                  <div key={i} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm text-ondark font-semibold">
                      <span className="bg-deep rounded-full px-2.5 py-0.5 text-[13px] text-loss font-semibold tabular mr-2">R{r.ruleNumber}</span>
                      {r.title}
                    </p>
                    <p className="text-sm text-mute mt-1">{r.whyToday}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {row.sources.length > 0 && (
            <Card title="Sources">
              <ul className="space-y-1">
                {row.sources.map((s, i) => {
                  const href = safeHttpUrl(s.url);
                  const label = s.title || s.url;
                  return (
                    <li key={i}>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="text-sm text-stone hover:text-ondark transition-colors break-all">
                          {label}
                        </a>
                      ) : (
                        <span className="text-sm text-stone break-all">{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </main>
  );
}

