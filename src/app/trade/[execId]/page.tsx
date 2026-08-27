import { notFound } from 'next/navigation';
import { getTradeByExecId, getSetups, getAttachmentsByExecId } from '@/lib/queries';
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

  const setupOptions = setupRows.map((s) => ({ number: s.number, name: s.name }));
  const aiConfig = getAiConfig();
  const setupName =
    annotation?.setupNumber != null
      ? `${annotation.setupNumber} — ${setupRows.find((s) => s.number === annotation.setupNumber)?.name ?? ''}`.trim()
      : '—';

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-12 space-y-6">
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
          {sessionDate && (
            <PillLink href={`/day/${sessionDate}`} active={false}>
              ← {longDate}
            </PillLink>
          )}
          <PillLink href="/trades" active={false}>
            All trades
          </PillLink>
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

            {/* Trade metrics */}
            <Card title="Trade metrics" className="h-full">
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
    </main>
  );
}
