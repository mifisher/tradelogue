/** The masking character used by maskSecret. A value still containing it was
 * never typed by a human. */
const MASK_CHAR = '…';

/** Which fields actually changed, and therefore should be written.
 *
 * Secrets are rendered masked, so submitting the whole form would write the
 * mask over the real credential. Untouched masked fields are dropped, and any
 * value that still carries the mask character is dropped regardless. */
export function setupPayload(
  values: Record<string, string>,
  initial: Record<string, string>,
  masked: readonly string[],
): Record<string, string> {
  const maskedKeys = new Set(masked);
  const payload: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === (initial[key] ?? '')) continue;
    if (maskedKeys.has(key) && value.includes(MASK_CHAR)) continue;
    payload[key] = value;
  }
  return payload;
}
