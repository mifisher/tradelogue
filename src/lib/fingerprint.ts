/** Stable identity for a trade across rebuilds: its first fill's execId,
 *  with any prorate suffix (':a'/':b') stripped. */
export function tradeFingerprint(executionIds: string[]): string {
  if (executionIds.length === 0) throw new Error('trade has no executions');
  return executionIds[0].replace(/:[ab]$/, '');
}
