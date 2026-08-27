/** Build a human-readable trade label e.g. "NVDA 170P" from a trade row. */
export function tradeLabel(row: {
  underlying: string;
  putCall?: string | null;
  strike?: number | null;
  description: string;
}): string {
  if (row.putCall) {
    const pc = row.putCall === 'P' ? 'P' : 'C';
    if (row.strike != null) {
      return `${row.underlying} ${row.strike % 1 === 0 ? row.strike.toFixed(0) : row.strike}${pc}`;
    }
    return `${row.underlying} ${pc}`;
  }
  // Stock / no contract info — use description trimmed
  return row.underlying;
}
