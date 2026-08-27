import { notFound } from 'next/navigation';
import {
  closedTrades,
  dailySummaries,
  toStatTrade,
  getSession,
  getAnnotationsByExecIds,
  getAttachments,
  navDates,
} from '@/lib/queries';
import { computeStats } from '@/lib/stats';
import { fmtPct } from '@/lib/format';
import { Card } from '@/components/card';
import { Stat } from '@/components/stat';
import { Pnl } from '@/components/pnl';
import { PillLink } from '@/components/pill-link';
import { TradesTable } from '@/components/trades-table';
import { SessionJournal } from '@/components/session-journal';
import { AttachmentGallery } from '@/components/attachment-gallery';
import { ViolationsCard } from '@/components/violations-card';
import { violationsForSession } from '@/lib/discipline';
import { AiCoaching } from '@/components/ai-coaching';
import { getCoachingReview } from '@/lib/ai-actions';
import { SyncButton } from '@/components/sync-button';
import { getRuleConfigs } from '@/lib/trading-rules';

export const dynamic = 'force-dynamic';

interface DayPageProps {
  params: Promise<{ date: string }>;
}

export default async function DayPage({ params }: DayPageProps) {
  const { date } = await params;

  // Validate date format — keep this notFound()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    notFound();
  }

  // Fetch trades for this day + journal data in parallel
  const [rows, allDays, session, attachmentRows, coachingReview, navigableDates, ruleConfigs] =
    await Promise.all([
      closedTrades({ from: date, to: date }),
      dailySummaries(),
      getSession(date),
      getAttachments(date),
      getCoachingReview(date),
      navDates(),
      getRuleConfigs(),
    ]);

  // Branch render on whether trades exist
  const hasTrades = rows.length > 0;

  // Re-sort ASC for chronological display
  const sortedRows = hasTrades
    ? [...rows].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
    : [];

  // Fetch annotations only when we have trades
  const execIds = sortedRows
    .map((r) => r.firstExecId)
    .filter((id): id is string => id != null);
  const annotationsMap = await getAnnotationsByExecIds(execIds);

  // Compute day stats (safe for empty array)
  const stats = computeStats(sortedRows.map(toStatTrade));

  // Prev/next navigation: sorted union of traded dates ∪ journaled dates
  // If current date is not in the union (brand-new, unsaved session), we
  // find nearest neighbors by string comparison — never throws.
  const currentIndex = navigableDates.indexOf(date);
  let prevDay: string | null = null;
  let nextDay: string | null = null;

  if (currentIndex > 0) {
    prevDay = navigableDates[currentIndex - 1];
  } else if (currentIndex === -1) {
    // Not in union yet — find nearest earlier date
    const earlier = navigableDates.filter((d) => d < date);
    prevDay = earlier.length > 0 ? earlier[earlier.length - 1] : null;
  }

  if (currentIndex >= 0 && currentIndex < navigableDates.length - 1) {
    nextDay = navigableDates[currentIndex + 1];
  } else if (currentIndex === -1) {
    // Not in union yet — find nearest later date
    const later = navigableDates.filter((d) => d > date);
    nextDay = later.length > 0 ? later[0] : null;
  }

  // Format the date UTC-safely to avoid off-by-one
  const dateObj = new Date(date + 'T12:00:00Z');
  const longDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Session P&L (from dailySummaries if available, else computed from trades)
  const sessionPnl = allDays.find((d) => d.day === date)?.pnl ?? stats.totalPnl;

  // Build serializable attachment list
  const attachmentList = attachmentRows.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    caption: a.caption ?? null,
  }));

  // Build serializable session initial props
  const sessionInitial = session
    ? {
        sentiment: session.sentiment,
        mood: session.mood,
        sleepScore: session.sleepScore,
        sleepMinutes: session.sleepMinutes,
        marketContext: session.marketContext,
        recap: session.recap,
      }
    : null;

  // Build grades map for the TradesTable (keyed by firstExecId)
  const grades: Record<string, string> = {};
  for (const [execId, ann] of annotationsMap) {
    if (ann.grade) grades[execId] = ann.grade;
  }

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12 space-y-6">
      {/* ── Header block ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Left: date + P&L */}
        <div>
          <h1 className="font-display text-3xl text-ondark">{longDate}</h1>
          <div className="mt-2">
            {hasTrades ? (
              <Pnl value={sessionPnl} className="text-2xl" />
            ) : (
              <span className="text-2xl text-mute">No trades synced yet</span>
            )}
          </div>
        </div>

        {/* Right: prev/next + calendar */}
        <div className="flex items-center gap-2 flex-wrap">
          {prevDay && (
            <PillLink href={`/day/${prevDay}`} active={false}>
              ←{' '}
              {new Date(prevDay + 'T12:00:00Z').toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </PillLink>
          )}
          {nextDay && (
            <PillLink href={`/day/${nextDay}`} active={false}>
              {new Date(nextDay + 'T12:00:00Z').toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}{' '}
              →
            </PillLink>
          )}
          <PillLink href="/calendar" active={false}>
            Calendar
          </PillLink>
        </div>
      </div>

      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-hairline rounded-[20px] overflow-hidden">
        <div className="bg-deep p-6">
          <Stat label="Trades" value={stats.tradeCount} tone="neutral" />
        </div>
        <div className="bg-deep p-6">
          <Stat
            label="Win rate"
            value={hasTrades ? fmtPct(stats.winRate) : '—'}
            sub={hasTrades ? `${stats.winCount}/${stats.tradeCount} trades` : undefined}
            tone={hasTrades && stats.winRate >= 0.5 ? 'gain' : 'loss'}
          />
        </div>
        <div className="bg-deep p-6">
          <Stat
            label="Best trade"
            value={stats.largestWin != null ? <Pnl value={stats.largestWin} /> : '—'}
            tone="neutral"
          />
        </div>
        <div className="bg-deep p-6">
          <Stat
            label="Worst trade"
            value={stats.largestLoss != null ? <Pnl value={stats.largestLoss} /> : '—'}
            tone="neutral"
          />
        </div>
      </div>

      {/* ── Discipline Card ── */}
      <Card title="Discipline">
        <ViolationsCard
          violations={hasTrades ? violationsForSession(date, sortedRows, session?.sentiment ?? null, ruleConfigs) : []}
          journaled={session !== null}
          hasTrades={hasTrades}
          checkedRuleNumbers={ruleConfigs.filter((rule) => rule.enabled && rule.detector !== null).map((rule) => rule.rule)}
        />
      </Card>

      {/* ── Session journal Card ── */}
      {/* Always rendered — this is the point of journal-first navigation */}
      <Card title="Journal">
        <SessionJournal sessionDate={date} initial={sessionInitial} />
      </Card>

      {/* ── AI coaching Card ── */}
      <AiCoaching
        sessionDate={date}
        hasTrades={hasTrades}
        review={
          coachingReview
            ? {
                whatWorked: coachingReview.whatWorked as string[],
                toImprove: coachingReview.toImprove as string[],
                patternsToWatch: coachingReview.patternsToWatch as string[],
                model: coachingReview.model,
                generatedAt: coachingReview.generatedAt.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              }
            : null
        }
      />

      {/* ── Coaching review Card (conditional) ── */}
      {session?.coachingReview && (
        <Card>
          <h2 className="font-display text-xl text-ondark mb-1">
            Coaching review{' '}
            <span className="text-stone text-base font-normal">(from journal)</span>
          </h2>
          <p className="whitespace-pre-wrap text-sm text-mute leading-relaxed mt-4">
            {session.coachingReview}
          </p>
        </Card>
      )}

      {/* ── Trades card ── */}
      <Card title="Trades">
        {hasTrades ? (
          <>
            <div className="flex justify-end mb-4">
              <SyncButton label="Sync" className="rounded-full bg-ondark text-canvas px-4 h-8 font-semibold text-sm disabled:opacity-50" />
            </div>
            <TradesTable rows={sortedRows} showDate={false} grades={grades} />
          </>
        ) : (
          <div className="py-4 space-y-3">
            <p className="text-sm text-mute">No trades synced for this day yet.</p>
            <SyncButton label="Sync from IBKR" />
          </div>
        )}
      </Card>

      {/* ── Screenshots Card — always rendered (session-level) ── */}
      <Card title="Screenshots">
        <AttachmentGallery sessionDate={date} attachments={attachmentList} />
      </Card>
    </main>
  );
}
