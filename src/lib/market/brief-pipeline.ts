import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { marketBriefs, tradingRules } from '@/db/schema';
import { sessionDate } from '@/lib/daily-pnl';
import { prefillMarketContext } from '@/lib/journal-actions';
import { underlyings } from '@/lib/queries';
import { generateStructuredObject, getAiConfig, type AiProvider } from '@/lib/ai/provider';
import { briefModel } from '@/lib/ai/client';
// Shared with the coach path: one backoff policy for every provider call.
import { retryTransient } from '@/lib/ai/coach';
import { briefContentSchema } from './brief-schema';
import { gatherAll } from './gather';
import { synthesizeBrief, collectSourceLinks, type RuleContext } from './synthesize';

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = ['TAVILY_API_KEY', 'FINNHUB_API_KEY'] as const;

const PROVIDER_KEY_NAMES: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export function briefEnvCheck(env: Env = process.env): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  const ai = getAiConfig(env);
  if (!ai.apiKey) missing.push(`${PROVIDER_KEY_NAMES[ai.provider]} (AI provider)`);
  for (const key of REQUIRED_KEYS) {
    if (!env[key]?.trim()) missing.push(key);
  }
  return { configured: missing.length === 0, missing };
}

export function runStatus(failedSourceCount: number): 'ok' | 'partial' {
  return failedSourceCount === 0 ? 'ok' : 'partial';
}

export interface BriefRunResult {
  id: number;
  status: 'ok' | 'partial' | 'failed';
  briefDate: string;
  error: string | null;
}

export async function runBriefPipeline(trigger: 'scheduled' | 'manual'): Promise<BriefRunResult> {
  const check = briefEnvCheck();
  if (!check.configured) {
    throw new Error(`Market brief not configured — set ${check.missing.join(', ')} in .env`);
  }

  const todayPt = sessionDate(new Date());
  const model = briefModel(); // config.models.brief from the shared AI provider

  // The trader's own names outrank everything in the earnings slate. Consumed
  // by selectEarnings during synthesis — gathering prices the whole window, so
  // it no longer needs to be told which names must not be missed.
  const tradedTickers = await underlyings().catch(() => [] as string[]);

  const gather = await gatherAll({
    finnhubKey: process.env.FINNHUB_API_KEY!,
    tavilyKey: process.env.TAVILY_API_KEY!,
    todayPt,
  });

  const ruleRows = await db
    .select()
    .from(tradingRules)
    .where(and(eq(tradingRules.enabled, true), isNull(tradingRules.deletedAt)));
  const rules: RuleContext[] = ruleRows.map((r) => ({
    ruleNumber: r.ruleNumber, title: r.title, description: r.description,
  }));

  const base = {
    briefDate: todayPt,
    trigger,
    quotes: gather.quotes.data,
    sources: collectSourceLinks(gather),
    model,
  };

  try {
    const brief = await synthesizeBrief({
      gather,
      rules,
      todayPt,
      tradedTickers,
      finnhubKey: process.env.FINNHUB_API_KEY!,
      // Retry at the provider boundary, not inside synthesizeBrief: that loop
      // rethrows AiProviderError untouched, so before this wrapper a single 429
      // killed the whole 5 AM run with "Rate limited by the API". Throttled
      // models refuse in under a second, so riding it out costs little.
      generateFn: (system, user) => retryTransient(() => generateStructuredObject({
        feature: 'brief',
        system,
        user,
        // 8000 was sized for nemotron-nano, which did not think out loud. Its
        // replacement glm-5.3-flash is a reasoning model and spent the entire
        // 8000 on `reasoning`, returning content:null with finish_reason:"length"
        // on every attempt — the real cause of the 08-23..08-26 brief failures.
        // A ceiling, not a spend: a healthy run uses ~1.1k completion tokens
        // (~$0.001), and the headroom is for the chain of thought.
        maxTokens: 32000,
        schema: briefContentSchema,
        jsonInstruction: 'Return a JSON object exactly matching the schema described in the system prompt.',
        label: 'Market brief synthesis',
      }), {
        // Far more patient than the interactive coach: this runs unattended at
        // 5 AM, and the ~38k-char prompt is exactly what a capacity-based
        // throttle refuses first. Small probes clear in ~30s, big ones take
        // longer, so spend up to ~3min waiting rather than lose the day's brief.
        attempts: 5,
        baseDelayMs: 15_000,
        maxDelayMs: 60_000,
      }),
    });
    const status = runStatus(gather.failedSourceCount);
    const [row] = await db
      .insert(marketBriefs)
      .values({ ...base, status, brief, error: null })
      .returning({ id: marketBriefs.id });

    // Seed today's journal market context from the overview so the trader does
    // not copy it in by hand. Best-effort: the brief is already saved, so a
    // prefill failure must not turn a good brief into a failed run.
    try {
      await prefillMarketContext(todayPt, brief.overview);
    } catch {
      // non-fatal: the market-context field simply stays manual for the day
    }

    return { id: row.id, status, briefDate: todayPt, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .insert(marketBriefs)
      .values({ ...base, status: 'failed', brief: null, error: message })
      .returning({ id: marketBriefs.id });
    return { id: row.id, status: 'failed', briefDate: todayPt, error: message };
  }
}
