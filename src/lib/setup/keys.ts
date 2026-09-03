/** Every environment variable the setup UI is allowed to write. The browser is
 * a trust boundary even on localhost, and this file is sourced at boot by the
 * app, the CLI scripts, and the launchd jobs — so an unrestricted write would
 * be an unrestricted way to change what those processes run. */
export const WRITABLE_KEYS = [
  'DATABASE_URL',
  'NEXT_PUBLIC_TRADING_TIMEZONE',
  'AI_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_MODEL',
  'OPENROUTER_COACH_MODEL',
  'OPENROUTER_VOICE_MODEL',
  'OPENROUTER_CHAT_MODEL',
  'OPENROUTER_BRIEF_MODEL',
  'OPENROUTER_JUDGE_MODEL',
  'MOONSHOT_API_KEY',
  'MOONSHOT_BASE_URL',
  'MOONSHOT_MODEL',
  'MOONSHOT_COACH_MODEL',
  'MOONSHOT_VOICE_MODEL',
  'MOONSHOT_CHAT_MODEL',
  'MOONSHOT_BRIEF_MODEL',
  'MOONSHOT_JUDGE_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_COACH_MODEL',
  'ANTHROPIC_VOICE_MODEL',
  'ANTHROPIC_CHAT_MODEL',
  'ANTHROPIC_BRIEF_MODEL',
  'ANTHROPIC_JUDGE_MODEL',
  'IBKR_FLEX_TOKEN',
  'IBKR_FLEX_QUERY_ID',
  'IBKR_TRADE_CONFIRM_QUERY_ID',
  'TAVILY_API_KEY',
  'FINNHUB_API_KEY',
  'RULE_OUTLAY_CAP',
  'RULE_REENTRY_PAUSE_MIN',
  'RULE_CIRCUIT_BREAKER',
  'RULE_CHOP_TRADE_CAP',
  'RULE_SESSION_OPEN_HOUR',
] as const;

const WRITABLE = new Set<string>(WRITABLE_KEYS);

/** DATABASE_URL counts: it carries a password. */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'DATABASE_URL',
  'OPENROUTER_API_KEY',
  'MOONSHOT_API_KEY',
  'ANTHROPIC_API_KEY',
  'IBKR_FLEX_TOKEN',
  'TAVILY_API_KEY',
  'FINNHUB_API_KEY',
]);

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export function maskSecret(value: string): string {
  if (value === '') return '';
  if (value.length <= 10) return '………';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function validateUpdates(updates: Record<string, unknown>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!WRITABLE.has(key)) throw new Error(`${key} is not a Tradelogue setting`);
    if (typeof value !== 'string') throw new Error(`${key} must be text`);
    // A newline would let one field write a second assignment into the file.
    if (/[\r\n]/.test(value)) throw new Error(`${key} must be a single line`);
    clean[key] = value.trim();
  }
  return clean;
}
