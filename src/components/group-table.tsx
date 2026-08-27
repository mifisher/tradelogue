import type { Stats } from '@/lib/stats';
import { Pnl } from './pnl';
import { fmtPct } from '@/lib/format';

interface GroupTableProps {
  groups: Map<string, Stats>;
  order?: string[];
  limit?: number;
}

export function GroupTable({ groups, order, limit }: GroupTableProps) {
  let keys: string[];

  if (order) {
    // render in specified order, skip missing keys
    keys = order.filter((k) => groups.has(k));
  } else {
    // sort by tradeCount descending
    keys = [...groups.keys()].sort(
      (a, b) => (groups.get(b)!.tradeCount) - (groups.get(a)!.tradeCount)
    );
  }

  if (limit !== undefined) {
    keys = keys.slice(0, limit);
  }

  return (
    <div className="divide-y divide-divider">
      {keys.map((key) => {
        const s = groups.get(key)!;
        return (
          <div
            key={key}
            className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="text-ondark text-sm font-semibold truncate">{key}</span>
              <span className="text-stone text-sm shrink-0">{s.tradeCount}</span>
            </div>
            <div className="flex items-center gap-6 shrink-0 ml-4">
              <span className="text-mute text-sm tabular w-12 text-right">
                {fmtPct(s.winRate)}
              </span>
              <span className="tabular text-sm w-24 text-right">
                <Pnl value={s.totalPnl} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
