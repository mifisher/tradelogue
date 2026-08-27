const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a dollar P&L value:
 *   positive → '+$1,234.50'
 *   negative → '-$1,234.50'
 *   zero     → '$0.00'
 */
export function fmtMoney(value: number): string {
  if (value === 0) return '$0.00';
  const abs = usdFmt.format(Math.abs(value));
  return value > 0 ? `+${abs}` : `-${abs}`;
}

const usdWholeFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Compact whole-dollar P&L for dense layouts (calendar cells):
 *   -1619.55 → '-$1,620', 1324.98 → '+$1,325', 0 → '$0'.
 * Sign reflects the actual value even when it rounds to $0.
 */
export function fmtMoneyWhole(value: number): string {
  if (value === 0) return '$0';
  const abs = usdWholeFmt.format(Math.round(Math.abs(value)));
  return value > 0 ? `+${abs}` : `-${abs}`;
}

/**
 * Format a decimal ratio as a percentage with one decimal place.
 * e.g. 0.553 → '55.3%'
 */
export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Format a duration in milliseconds as a human-readable hold time.
 *   < 60s  → '45s'
 *   < 1h   → '35m'
 *   >= 1h  → '1h 35m'
 */
export function fmtHold(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
