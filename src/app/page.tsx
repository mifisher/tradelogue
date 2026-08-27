import Link from 'next/link';
import {
  closedTrades,
  toStatTrade,
  dailySummaries,
  tradesForAllSetups,
  getSetups,
  sentimentByDate,
} from '@/lib/queries';
import { sessionDate } from '@/lib/daily-pnl';
import { PillLink } from '@/components/pill-link';
import {
  computeStats,
  equityCurve,
  dayStreaks,
  groupStats,
  byTicker,
  byDayOfWeek,
  byEntryHour,
  type Stats,
} from '@/lib/stats';
import { fmtMoney, fmtPct } from '@/lib/format';
import { Card } from '@/components/card';
import { Stat } from '@/components/stat';
import { Pnl } from '@/components/pnl';
import { EquityChart } from '@/components/equity-chart';
import { GroupTable } from '@/components/group-table';
import { disciplineOverview } from '@/lib/discipline';
import { SyncButton } from '@/components/sync-button';
import { getLatestPatternAnalysis } from '@/lib/pattern-analysis-actions';
import { patternFocusPreview } from '@/lib/pattern-analysis';
import { getRuleConfigs } from '@/lib/trading-rules';
import { MarketStrip } from '@/components/market-strip';
import { IndexSnapshotsCard } from '@/components/index-snapshots-card';
import { PAGE_WIDE } from '@/lib/layout';
import { TodayEconCard } from '@/components/today-econ-card';
import { TodayEarningsCard } from '@/components/today-earnings-card';
import { getLatestMarketBrief, getMarketBriefConfig } from '@/lib/market-brief-actions';
import { underlyings } from '@/lib/queries';
import { timezoneLabel } from '@/lib/config';

export const dynamic = 'force-dynamic';

function formatDateRange(first: string, last: string): string {
  const fmt = (d: string) => {
    const date = new Date(d + 'T12:00:00Z');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  return `${fmt(first)} → ${fmt(last)}`;
}

export default async function Home() {
  // Fetch data
  const [rows, days, setupTradesMap, setupRows, sentiments, patternAnalysis, ruleConfigs, marketBrief, marketConfig, tradedTickers] = await Promise.all([
    closedTrades(),
    dailySummaries(),
    tradesForAllSetups(),
    getSetups(),
    sentimentByDate(),
    getLatestPatternAnalysis(),
    getRuleConfigs(),
    getLatestMarketBrief(),
    getMarketBriefConfig(),
    underlyings().catch(() => [] as string[]),
  ]);

  const statTrades = rows.map(toStatTrade);
  const stats = computeStats(statTrades);
  const curve = equityCurve(days);
  const streaks = dayStreaks(days);

  // Day-level metrics
  const greenDays = days.filter((d) => d.pnl > 0).length;
  const totalSessions = days.length;
  const dayWinRate = totalSessions > 0 ? greenDays / totalSessions : 0;

  // Date range
  const firstDay = days[0]?.day ?? '';
  const lastDay = days[days.length - 1]?.day ?? '';
  const dateRange = firstDay && lastDay ? formatDateRange(firstDay, lastDay) : '';

  // Breakdown groups
  const byTickerMap = groupStats(statTrades, byTicker);
  const byWeekdayMap = groupStats(statTrades, byDayOfWeek);
  const byHourMap = groupStats(statTrades, byEntryHour);

  // "By setup" breakdown: Map<string label, Stats>, ordered by setup number
  function truncateName(name: string, max = 18): string {
    return name.length > max ? name.slice(0, max) + '…' : name;
  }
  const bySetupMap = new Map<string, Stats>();
  // Walk setups in number order so the table is ordered 1, 2, 3, 4
  for (const setup of setupRows) {
    const tradeRowsForSetup = setupTradesMap.get(setup.number) ?? [];
    if (tradeRowsForSetup.length === 0) continue;
    const label = `${setup.number} — ${truncateName(setup.name)}`;
    const statTradesForSetup = tradeRowsForSetup.map(toStatTrade);
    bySetupMap.set(label, computeStats(statTradesForSetup));
  }
  // Tagged count = total trades with a setupNumber annotation
  const taggedCount = [...setupTradesMap.values()].reduce((sum, arr) => sum + arr.length, 0);
  const totalClosedCount = rows.length; // all closed trades (M)

  // Weekday order Mon–Fri
  const weekdayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  // Entry hour order: the market-hours span in TRADING_TIMEZONE
  // Sort by hour numeric ascending starting from 6 AM
  const hourKeys = [...byHourMap.keys()].sort((a, b) => {
    const parseHour = (h: string) => {
      const match = h.match(/^(\d+)\s*(AM|PM)$/i);
      if (!match) return 0;
      let n = parseInt(match[1], 10);
      if (match[2].toUpperCase() === 'PM' && n !== 12) n += 12;
      if (match[2].toUpperCase() === 'AM' && n === 12) n = 0;
      return n;
    };
    return parseHour(a) - parseHour(b);
  });
  // Start from 6 AM
  const sixAmIndex = hourKeys.findIndex((k) => k === '6 AM');
  const sortedHourKeys =
    sixAmIndex >= 0
      ? [...hourKeys.slice(sixAmIndex), ...hourKeys.slice(0, sixAmIndex)]
      : hourKeys;

  // Discipline overview
  const discipline = disciplineOverview(rows, sentiments, days, ruleConfigs);

  // Recent sessions: last 10
  const recentDays = [...days].reverse().slice(0, 10);

  // Day streak display
  const currentStreak = streaks.current;
  const streakTone = currentStreak > 0 ? 'gain' : currentStreak < 0 ? 'loss' : 'neutral';
  const streakLabel = currentStreak > 0
    ? `${currentStreak}W`
    : currentStreak < 0
    ? `${Math.abs(currentStreak)}L`
    : '—';

  const allTimeTone = stats.totalPnl >= 0 ? 'gain' : 'loss';
  const focusAreas = patternFocusPreview(patternAnalysis);

  // Today in the configured trading timezone, for the session shortcut
  const todayPT = sessionDate(new Date());

  // The rail's econ/earnings cards filter this to today themselves, so a brief
  // left over from a previous session simply renders them empty rather than
  // showing another day's tape as if it were this one.
  const marketBriefContent = marketBrief.row?.brief ?? null;

  return (
    <main className={`${PAGE_WIDE} mx-auto px-6 pb-24`}>
      {/* ── Two-column page: main content (left) + full-length rail (right) ── */}
      <div className="pt-16 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      {/* ── Left column: all primary content ── */}
      <div className="min-w-0">
      <section className="mb-8">
        {/* Kicker */}
        <p className="text-[13px] uppercase tracking-widest text-stone mb-3">
          All-time P&amp;L
        </p>

        {/* Hero figure */}
        <p
          className={`font-display tabular leading-none ${allTimeTone === 'gain' ? 'text-gain' : 'text-loss'}`}
          style={{ fontSize: 'clamp(56px, 8vw, 96px)' }}
        >
          {fmtMoney(stats.totalPnl)}
        </p>

        {/* Sub-line */}
        <p className="text-mute mt-3 text-base">
          {stats.tradeCount} trades &middot; {totalSessions} sessions &middot; {dateRange}
        </p>

        {/* Equity curve */}
        <div className="mt-8 -mx-1">
          <EquityChart data={curve} />
        </div>

        {/* Today shortcut + Sync button */}
        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <PillLink href={`/day/${todayPT}`} active={false}>
            Today&apos;s session →
          </PillLink>
          <SyncButton />
        </div>
      </section>

      <MarketStrip
        row={marketBrief.row}
        configured={marketConfig.configured}
        latestFailure={marketBrief.latestFailure}
        todayPt={todayPT}
      />

      {/* ── Stat grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-hairline rounded-[20px] overflow-hidden mb-8">
        {/* Win rate — day level */}
        <div className="bg-deep p-6">
          <Stat
            label="Win rate"
            value={fmtPct(dayWinRate)}
            sub={`${greenDays}/${totalSessions} days`}
            tone={dayWinRate >= 0.5 ? 'gain' : 'loss'}
          />
        </div>

        {/* Profit factor */}
        <div className="bg-deep p-6">
          <Stat
            label="Profit factor"
            value={stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '—'}
            tone={
              stats.profitFactor === null
                ? 'neutral'
                : stats.profitFactor >= 1
                ? 'gain'
                : 'loss'
            }
          />
        </div>

        {/* Expectancy */}
        <div className="bg-deep p-6">
          <Stat
            label="Expectancy"
            value={fmtMoney(stats.expectancy)}
            sub="per trade"
            tone={stats.expectancy >= 0 ? 'gain' : 'loss'}
          />
        </div>

        {/* Avg win */}
        <div className="bg-deep p-6">
          <Stat
            label="Avg win"
            value={stats.avgWin !== null ? fmtMoney(stats.avgWin) : '—'}
            tone="gain"
          />
        </div>

        {/* Avg loss */}
        <div className="bg-deep p-6">
          <Stat
            label="Avg loss"
            value={stats.avgLoss !== null ? fmtMoney(stats.avgLoss) : '—'}
            tone="loss"
          />
        </div>

        {/* Day streak */}
        <div className="bg-deep p-6">
          <Stat
            label="Day streak"
            value={streakLabel}
            sub={`Best ${streaks.bestGreenStreak}W · Worst ${streaks.worstRedStreak}L`}
            tone={streakTone}
          />
        </div>
      </div>

      {/* ── Current focus ── */}
      <Card title="Current focus" className="mb-8">
        {focusAreas.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-3">
            {focusAreas.map((item, index) => (
              <div key={index} className="border-l border-hairline pl-4">
                <h3 className="font-display text-lg text-ondark">{item.title}</h3>
                <p className="mt-2 text-sm text-mute leading-relaxed">{item.action}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-mute">
            Generate a pattern analysis to surface your top cross-trade coaching priorities.
          </p>
        )}
        <div className="mt-5 pt-4 border-t border-divider">
          <Link href="/coach" className="text-stone hover:text-ondark text-sm transition-colors">
            Open coach →
          </Link>
        </div>
      </Card>

      {/* ── Breakdown row ── */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* By ticker */}
        <Card title="By ticker">
          {/* Column headers */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-divider">
            <span className="text-stone text-[13px] uppercase tracking-wide">Ticker</span>
            <div className="flex items-center gap-6">
              <span className="text-stone text-[13px] uppercase tracking-wide w-12 text-right">Win %</span>
              <span className="text-stone text-[13px] uppercase tracking-wide w-24 text-right">P&amp;L</span>
            </div>
          </div>
          <GroupTable groups={byTickerMap} limit={8} />
        </Card>

        {/* By weekday */}
        <Card title="By weekday">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-divider">
            <span className="text-stone text-[13px] uppercase tracking-wide">Day</span>
            <div className="flex items-center gap-6">
              <span className="text-stone text-[13px] uppercase tracking-wide w-12 text-right">Win %</span>
              <span className="text-stone text-[13px] uppercase tracking-wide w-24 text-right">P&amp;L</span>
            </div>
          </div>
          <GroupTable groups={byWeekdayMap} order={weekdayOrder} />
        </Card>

        {/* By entry hour */}
        <Card title="By entry hour">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-divider">
            <span className="text-stone text-[13px] uppercase tracking-wide">Hour ({timezoneLabel()})</span>
            <div className="flex items-center gap-6">
              <span className="text-stone text-[13px] uppercase tracking-wide w-12 text-right">Win %</span>
              <span className="text-stone text-[13px] uppercase tracking-wide w-24 text-right">P&amp;L</span>
            </div>
          </div>
          <GroupTable groups={byHourMap} order={sortedHourKeys} />
        </Card>

        {/* By setup */}
        <Card title="By setup">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-divider">
            <span className="text-stone text-[13px] uppercase tracking-wide">Setup</span>
            <div className="flex items-center gap-6">
              <span className="text-stone text-[13px] uppercase tracking-wide w-12 text-right">Win %</span>
              <span className="text-stone text-[13px] uppercase tracking-wide w-24 text-right">P&amp;L</span>
            </div>
          </div>
          {bySetupMap.size === 0 ? (
            <p className="text-mute text-sm py-4">No tagged trades yet.</p>
          ) : (
            <GroupTable groups={bySetupMap} />
          )}
          <p className="text-[13px] text-stone mt-4 pt-3 border-t border-divider">
            {taggedCount} of {totalClosedCount} trades tagged
          </p>
        </Card>
      </div>

      {/* ── Discipline ── */}
      <Card title="Discipline" className=" mb-8">
        {/* Dose-response buckets: discipline level vs avg daily P&L */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-hairline rounded-[20px] overflow-hidden mb-6">
          {discipline.buckets.map((bucket) => (
            <div key={bucket.label} className="bg-deep p-6">
              <Stat
                label={bucket.label}
                value={`${bucket.count} sessions`}
                sub={
                  <>
                    avg <Pnl value={bucket.avgPnl} /> / day
                  </>
                }
                tone="neutral"
              />
            </div>
          ))}
        </div>

        {/* By-rule breakdown table */}
        {discipline.byRule.length > 0 && (
          <>
            {/* Header row */}
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 pb-2 mb-1 border-b border-divider">
              <span className="text-stone text-[13px] uppercase tracking-wide">Rule</span>
              <span className="text-stone text-[13px] uppercase tracking-wide">Title</span>
              <span className="text-stone text-[13px] uppercase tracking-wide text-right w-20">Violations</span>
              <span className="text-stone text-[13px] uppercase tracking-wide text-right w-20">Sessions</span>
              <span className="text-stone text-[13px] uppercase tracking-wide text-right w-28">Affected P&amp;L</span>
            </div>

            {/* Data rows */}
            <div className="divide-y divide-divider">
              {discipline.byRule.map((row) => (
                <div
                  key={row.rule}
                  className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 py-3 first:pt-0 last:pb-0"
                >
                  <span className="shrink-0 bg-deep rounded-full px-2.5 py-0.5 text-[13px] text-loss font-semibold tabular">
                    R{row.rule}
                  </span>
                  <span className="text-ondark text-sm truncate">{row.title}</span>
                  <span className="text-stone text-sm tabular text-right w-20">{row.violationCount}</span>
                  <span className="text-stone text-sm tabular text-right w-20">{row.sessionsAffected}</span>
                  <span className="tabular text-sm text-right w-28">
                    <Pnl value={row.affectedPnl} />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {discipline.byRule.length === 0 && (
          <p className="text-sm text-gain">✓ No violations recorded across all sessions</p>
        )}
      </Card>
      </div>

      {/* ── Right rail: today's market context first, then the session history ── */}
      <div className="flex flex-col gap-8">
        {/* Today's tape, mirroring /market. Hidden entirely until the brief is
            configured, the same way MarketStrip stays out of the way. The
            snapshot card handles a missing or stale brief itself, so it shows
            even when there is no content to filter. */}
        {marketConfig.configured && (
          <IndexSnapshotsCard row={marketBrief.row} todayPt={todayPT} />
        )}
        {marketConfig.configured && marketBriefContent && (
          <>
            <TodayEconCard events={marketBriefContent.econCalendar} todayPt={todayPT} />
            <TodayEarningsCard
              earnings={marketBriefContent.earnings}
              todayPt={todayPT}
              tradedTickers={tradedTickers}
            />
          </>
        )}

        <Card title="Recent sessions">
          {/* Column headers */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-divider">
            <span className="text-stone text-[13px] uppercase tracking-wide">Date</span>
            <div className="flex items-center gap-8">
              <span className="text-stone text-[13px] uppercase tracking-wide w-12 text-right">Trades</span>
              <span className="text-stone text-[13px] uppercase tracking-wide w-24 text-right">P&amp;L</span>
            </div>
          </div>

          <div className="divide-y divide-divider">
            {recentDays.map((d) => (
              <Link
                key={d.day}
                href={`/day/${d.day}`}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-lift -mx-8 px-8 transition-colors"
              >
                <span className="text-ondark text-sm font-semibold">
                  {new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </span>
                <div className="flex items-center gap-8">
                  <span className="text-stone text-sm tabular w-12 text-right">{d.tradeCount}</span>
                  <span className="tabular text-sm w-24 text-right">
                    <Pnl value={d.pnl} />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-divider">
            <Link
              href="/calendar"
              className="text-stone hover:text-ondark text-sm transition-colors"
            >
              View calendar →
            </Link>
          </div>
        </Card>
      </div>
      </div>
    </main>
  );
}
