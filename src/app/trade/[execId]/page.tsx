import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTradeByExecId, getSetups, getAttachmentsByExecId, closedTrades } from '@/lib/queries';
import type { TradeRow } from '@/lib/queries';
import { tradeLabel } from '@/lib/trade-label';
import { fmtHold } from '@/lib/format';
import { aiConfigured } from '@/lib/ai/client';
import { getAiConfig, missingApiKeyMessage } from '@/lib/ai/provider';
import { Card } from '@/components/card';
import { Pnl } from '@/components/pnl';
import { PillLink } from '@/components/pill-link';
import { AnnotationEditor } from '@/components/annotation-editor';
import { ChartScreenshot } from '@/components/chart-screenshot';
import { TRADING_TIMEZONE, timezoneLabel } from '@/lib/config';
import { PageShell } from '@/components/page-shell';

export const dynamic = 'force-dynamic';

interface TradePageProps {
  params: Promise<{ execId: string }>;
}

const TZ_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function fmtPrice(price: number | null | undefined): string {
  if (price == null) return '—';
  return `$${price.toFixed(2)}`;
}

/** One label/value row in the Trade Metrics panel. */
function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-[13px] uppercase tracking-wide text-stone shrink-0">{label}</dt>
      <dd className="text-sm text-ondark text-right tabular break-words min-w-0">{value}</dd>
    </div>
  );
}

/** Prev/next pill — stays in place, greyed out, when there is no neighbouring trade. */
function NavPill({ trade, label }: { trade: TradeRow | null; label: string }) {
  if (!trade?.firstExecId) {
    return (
      <span className="rounded-full px-4 py-1.5 text-sm font-semibold bg-elevated text-stone opacity-40">
        {label}
      </span>
    );
  }
  return (
    <PillLink href={`/trade/${encodeURIComponent(trade.firstExecId)}`} active={false}>
      {label}
    </PillLink>
  );
}

export default async function TradePage({ params }: TradePageProps) {
  const { execId } = await params;

  const resolvedExecId = decodeURIComponent(execId);
  const [detail, setupRows, attachmentRows] = await Promise.all([
    getTradeByExecId(resolvedExecId),
    getSetups(),
    getAttachmentsByExecId(resolvedExecId),
  ]);

  if (!detail) notFound();
  const { trade, annotation } = detail;

  // One chart per trade — use the most recent attachment if any exist.
  const chart =
    attachmentRows.length > 0
      ? { id: attachmentRows[attachmentRows.length - 1].id, fileName: attachmentRows[attachmentRows.length - 1].fileName }
      : null;

  const label = tradeLabel(trade);
  const sessionDate = trade.sessionDate ?? '';
  const holdMs =
    trade.closedAt && trade.openedAt
      ? trade.closedAt.getTime() - trade.openedAt.getTime()
      : null;

  const longDate = sessionDate
    ? new Date(sessionDate + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';

  // Prev/next trade within the same session, chronological like the day view.
  const siblings = sessionDate
    ? (await closedTrades({ from: sessionDate, to: sessionDate }))
        .filter((t) => t.firstExecId != null)
        .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
    : [];
  const here = siblings.findIndex((t) => t.firstExecId === trade.firstExecId);
  const prevTrade = here > 0 ? siblings[here - 1] : null;
  const nextTrade = here >= 0 && here < siblings.length - 1 ? siblings[here + 1] : null;

  const setupOptions = setupRows.map((s) => ({ number: s.number, name: s.name }));
  const aiConfig = getAiConfig();
  const setupName =
    annotation?.setupNumber != null
      ? `${annotation.setupNumber} — ${setupRows.find((s) => s.number === annotation.setupNumber)?.name ?? ''}`.trim()
      : '—';

  return (
    <PageShell className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-ondark">{label}</h1>
          <div className="mt-2 flex items-center gap-3">
            <Pnl value={trade.realizedPnl ?? 0} className="text-2xl" />
            <span
              className={`rounded-full px-3 py-0.5 text-[13px] bg-deep ${
                trade.direction === 'long' ? 'text-gain' : 'text-loss'
              }`}
            >
              {trade.direction}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <NavPill trade={prevTrade} label="← Previous trade" />
          <NavPill trade={nextTrade} label="Next trade →" />
        </div>
      </div>

      {trade.firstExecId ? (
        <>
          {/* ── Chart + metrics, side by side (cards stretch to equal height) ── */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Chart (wider) */}
            <div className="lg:col-span-2">
              <Card title="Chart" className="h-full">
                <ChartScreenshot
                  sessionDate={sessionDate}
                  firstExecId={trade.firstExecId}
                  screenshot={chart}
                />
              </Card>
            </div>

            {/* Right column: metrics + the rest of the session */}
            <div className="space-y-6">
            <Card title="Trade metrics">
              <dl className="divide-y divide-divider">
                <MetricRow label={`Opened (${timezoneLabel()})`} value={TZ_TIME.format(trade.openedAt)} />
                <MetricRow
                  label={`Closed (${timezoneLabel()})`}
                  value={trade.closedAt ? TZ_TIME.format(trade.closedAt) : '—'}
                />
                <MetricRow label="Duration" value={holdMs != null ? fmtHold(holdMs) : '—'} />
                <MetricRow label="Quantity" value={trade.quantityOpened} />
                <MetricRow
                  label="Entry → Exit"
                  value={`${fmtPrice(trade.avgEntryPrice)} → ${fmtPrice(trade.avgExitPrice)}`}
                />
                <MetricRow label="Contract" value={trade.description} />
                <MetricRow label="Fees" value={`$${Math.abs(trade.commissions).toFixed(2)}`} />
                <MetricRow label="Setup" value={setupName} />
                <MetricRow label="Grade" value={annotation?.grade ?? '—'} />
              </dl>
            </Card>

            {siblings.length > 0 && (
              <Card title="Session trades">
                <ul className="-mx-2 space-y-1">
                  {siblings.map((t) => {
                    const current = t.firstExecId === trade.firstExecId;
                    const body = (
                      <>
                        <span className="min-w-0">
                          <span className={`block truncate ${current ? 'text-ondark font-semibold' : 'text-mute'}`}>
                            {tradeLabel(t)}
                          </span>
                          <span className="block text-[13px] text-stone tabular">
                            {TZ_TIME.format(t.openedAt)}
                          </span>
                        </span>
                        <Pnl value={t.realizedPnl ?? 0} className="text-sm shrink-0" />
                      </>
                    );
                    return (
                      <li key={t.id}>
                        {current ? (
                          <div className="flex items-center justify-between gap-3 rounded-xl bg-lift px-2 py-2 text-sm">
                            {body}
                          </div>
                        ) : (
                          <Link
                            href={`/trade/${encodeURIComponent(t.firstExecId!)}`}
                            className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-lift transition-colors"
                          >
                            {body}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <Link
                  href={`/day/${sessionDate}`}
                  className="mt-5 block text-sm text-stone hover:text-ondark transition-colors"
                >
                  {longDate} →
                </Link>
              </Card>
            )}
            </div>
          </div>

          {/* ── Trade notes (full width, below) ── */}
          <Card title="Trade notes">
            <AnnotationEditor
              trade={{
                firstExecId: trade.firstExecId,
                label,
                sub: TZ_TIME.format(trade.openedAt),
                pnl: trade.realizedPnl ?? 0,
              }}
              sessionDate={sessionDate}
              setups={setupOptions}
              aiConfigured={aiConfigured()}
              aiMissingMessage={missingApiKeyMessage(aiConfig)}
              underlying={trade.underlying}
              direction={trade.direction}
              initial={
                annotation
                  ? {
                      setupNumber: annotation.setupNumber,
                      thesis: annotation.thesis,
                      executionNotes: annotation.executionNotes,
                      grade: annotation.grade,
                      gradeReason: annotation.gradeReason,
                      setupSuggestion: annotation.setupSuggestion,
                    }
                  : null
              }
            />
          </Card>
        </>
      ) : (
        <Card title="Trade notes">
          <p className="text-stone text-sm">This trade has no stable id and cannot be annotated.</p>
        </Card>
      )}
    </PageShell>
  );
}
