'use client';

import {
  AreaChart,
  Area,
  XAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { fmtMoney } from '@/lib/format';

interface DataPoint {
  day: string;
  pnl: number;
  cumPnl: number;
}

interface EquityChartProps {
  data: DataPoint[];
}

/** Thin ~6 tick labels across the date range */
function buildTicks(data: DataPoint[]): string[] {
  if (data.length === 0) return [];
  const step = Math.max(1, Math.floor(data.length / 6));
  const ticks: string[] = [];
  for (let i = 0; i < data.length; i += step) {
    ticks.push(data[i].day);
  }
  return ticks;
}

function formatMonthTick(day: string): string {
  // day is 'YYYY-MM-DD'; show abbreviated month
  const d = new Date(day + 'T12:00:00Z');
  return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

interface TooltipPayload {
  payload?: DataPoint;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const d = new Date(point.day + 'T12:00:00Z');
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="bg-elevated rounded-[12px] px-4 py-3 text-sm border border-hairline">
      <p className="text-stone text-[13px] mb-1">{dateStr}</p>
      <p className={`tabular font-semibold ${point.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
        {fmtMoney(point.pnl)}{' '}
        <span className="text-stone font-normal text-[12px]">day</span>
      </p>
      <p className="tabular text-mute text-[13px] mt-0.5">
        {fmtMoney(point.cumPnl)}{' '}
        <span className="text-[12px]">cumulative</span>
      </p>
    </div>
  );
}

export function EquityChart({ data }: EquityChartProps) {
  if (data.length === 0) return null;

  const finalCumPnl = data[data.length - 1]?.cumPnl ?? 0;
  const color = finalCumPnl >= 0 ? 'var(--color-gain)' : 'var(--color-loss)';
  const gradientId = 'equity-gradient';
  const ticks = buildTicks(data);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.12} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="day"
          ticks={ticks}
          tickFormatter={formatMonthTick}
          axisLine={false}
          tickLine={false}
          stroke="transparent"
          tick={{ fill: '#8d969e', fontSize: 12 }}
          interval="preserveStartEnd"
        />

        <ReferenceLine
          y={0}
          stroke="var(--color-hairline)"
          strokeDasharray="4 4"
        />

        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content={(props: any) => <CustomTooltip {...props} />}
          cursor={{ stroke: 'var(--color-hairline)', strokeWidth: 1 }}
        />

        <Area
          type="monotone"
          dataKey="cumPnl"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: 'transparent' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
