'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pnl } from '@/components/pnl';
import { fmtHold } from '@/lib/format';
import type { TradeRow } from '@/lib/queries';
import { TRADING_TIMEZONE, timezoneLabel } from '@/lib/config';

interface TradesTableProps {
  rows: TradeRow[];
  showDate?: boolean;
  grades?: Record<string, string>; // keyed by firstExecId
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

export function TradesTable({ rows, showDate = false, grades }: TradesTableProps) {
  const router = useRouter();
  const totalPnl = rows.reduce((sum, r) => sum + (r.realizedPnl ?? 0), 0);

  return (
    <div className="overflow-x-auto -mx-8">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-divider">
            {showDate && (
              <th className="text-left px-8 py-3 text-[13px] uppercase text-stone font-normal whitespace-nowrap">
                Date
              </th>
            )}
            <th className="text-left px-4 first:pl-8 py-3 text-[13px] uppercase text-stone font-normal whitespace-nowrap">
              Opened ({timezoneLabel()})
            </th>
            <th className="text-left px-4 py-3 text-[13px] uppercase text-stone font-normal">
              Ticker
            </th>
            <th className="text-left px-4 py-3 text-[13px] uppercase text-stone font-normal">
              Side
            </th>
            <th className="text-right px-4 py-3 text-[13px] uppercase text-stone font-normal">
              Qty
            </th>
            <th className="text-right px-4 py-3 text-[13px] uppercase text-stone font-normal whitespace-nowrap">
              Entry → Exit
            </th>
            <th className="text-right px-4 py-3 text-[13px] uppercase text-stone font-normal">
              Hold
            </th>
            <th className="text-right px-4 last:pr-8 py-3 text-[13px] uppercase text-stone font-normal">
              P&amp;L
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-divider">
          {rows.map((row) => {
            const holdMs =
              row.closedAt && row.openedAt
                ? row.closedAt.getTime() - row.openedAt.getTime()
                : null;
            const sessionDate = row.sessionDate ?? '';

            return (
              <tr
                key={row.id}
                onClick={() => {
                  if (row.firstExecId) router.push(`/trade/${row.firstExecId}`);
                }}
                className={`hover:bg-lift transition-colors ${
                  row.firstExecId ? 'cursor-pointer' : ''
                }`}
              >
                {showDate && (
                  <td className="px-8 py-3 text-stone whitespace-nowrap">
                    <Link
                      href={`/day/${sessionDate}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-ondark transition-colors"
                    >
                      {new Date(sessionDate + 'T12:00:00Z').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </Link>
                  </td>
                )}
                <td className="px-4 first:pl-8 py-3 text-mute tabular whitespace-nowrap font-mono text-[13px]">
                  {TZ_TIME.format(row.openedAt)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-0">
                    <span className="text-ondark font-semibold">{row.underlying}</span>
                    {grades && row.firstExecId && grades[row.firstExecId] && (
                      <span className="ml-2 rounded-full bg-deep px-2 py-0.5 text-[11px] text-stone">
                        {grades[row.firstExecId]}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-stone">{row.description}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-3 py-0.5 text-[13px] bg-deep whitespace-nowrap ${
                      row.direction === 'long' ? 'text-gain' : 'text-loss'
                    }`}
                  >
                    {row.direction}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular text-ondark">
                  {row.quantityOpened}
                </td>
                <td className="px-4 py-3 text-right tabular text-mute whitespace-nowrap">
                  {fmtPrice(row.avgEntryPrice)} → {fmtPrice(row.avgExitPrice)}
                </td>
                <td className="px-4 py-3 text-right text-mute whitespace-nowrap">
                  {holdMs != null ? fmtHold(holdMs) : '—'}
                </td>
                <td className="px-4 last:pr-8 py-3 text-right whitespace-nowrap">
                  <Pnl value={row.realizedPnl ?? 0} />
                </td>
              </tr>
            );
          })}
        </tbody>

        {!showDate && (
          <tfoot>
            <tr className="border-t border-hairline">
              <td
                colSpan={7}
                className="px-4 first:pl-8 py-3 text-stone text-[13px] font-semibold"
              >
                Session total
              </td>
              <td className="px-4 last:pr-8 py-3 text-right whitespace-nowrap font-semibold">
                <Pnl value={Math.round(totalPnl * 100) / 100} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
