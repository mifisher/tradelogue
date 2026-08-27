import { fmtMoney, fmtMoneyWhole } from '@/lib/format';

interface PnlProps {
  value: number;
  className?: string;
  /** Whole-dollar display for dense layouts (calendar cells). */
  whole?: boolean;
}

export function Pnl({ value, className, whole }: PnlProps) {
  const toneClass = value > 0 ? 'text-gain' : 'text-loss';
  return (
    <span className={`tabular ${toneClass}${className ? ` ${className}` : ''}`}>
      {whole ? fmtMoneyWhole(value) : fmtMoney(value)}
    </span>
  );
}
