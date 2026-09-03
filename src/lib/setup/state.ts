import { getAiConfig, isAiConfigured } from '@/lib/ai/provider';

type Env = Record<string, string | undefined>;

export type SetupArea = 'database' | 'timezone' | 'ai' | 'ibkr' | 'market';

export interface SetupState {
  database: boolean;
  timezone: boolean;
  ai: boolean;
  ibkr: boolean;
  market: boolean;
  /** No database url: the app can render nothing but the wizard. */
  needsSetup: boolean;
  /** Usable, but a headline feature is still switched off. */
  incomplete: boolean;
}

function set(env: Env, key: string): boolean {
  return Boolean(env[key]?.trim());
}

/** Reads env only — never the database, which may not exist yet. Runs in the
 * root layout on every request, so it stays a pure object read. */
export function setupState(env: Env = process.env): SetupState {
  const database = set(env, 'DATABASE_URL');
  const timezone = set(env, 'NEXT_PUBLIC_TRADING_TIMEZONE');
  // Delegated so "AI is configured" cannot drift from what the AI features test.
  const ai = isAiConfigured(getAiConfig(env));
  // Mirrors syncFromIbkr: a token plus either query id.
  const ibkr =
    set(env, 'IBKR_FLEX_TOKEN') &&
    (set(env, 'IBKR_FLEX_QUERY_ID') || set(env, 'IBKR_TRADE_CONFIRM_QUERY_ID'));
  const market = set(env, 'TAVILY_API_KEY') && set(env, 'FINNHUB_API_KEY');

  return {
    database,
    timezone,
    ai,
    ibkr,
    market,
    needsSetup: !database,
    incomplete: database && (!ai || !ibkr),
  };
}
