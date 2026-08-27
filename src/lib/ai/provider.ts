import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export type AiProvider = 'anthropic' | 'moonshot' | 'openrouter';
export type AiFeature = 'coach' | 'voice' | 'chat' | 'judge' | 'brief';

export interface AiConfig {
  provider: AiProvider;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  models: Record<AiFeature, string>;
}

export interface StructuredObjectRequest<T> {
  feature: AiFeature;
  system: string;
  user: string;
  maxTokens: number;
  schema: z.ZodType<T>;
  jsonInstruction: string;
  label: string;
  thinking?: { type: 'adaptive' };
  /** OpenRouter-only. Models with mandatory reasoning default to their own
   * effort — glm-5.3-flash defaults to "max", which spends ~40s and 7k chars
   * thinking about a request whose answer is ten short fields. Set 'low' for
   * interactive paths where the trader is watching a spinner. */
  reasoningEffort?: 'low' | 'high' | 'max';
  config?: AiConfig;
}

interface MoonshotJsonRequestBody {
  model: string;
  max_tokens: number;
  response_format: { type: 'json_object' };
  thinking?: { type: 'disabled' };
  reasoning?: { effort: 'low' | 'high' | 'max' };
  messages: {
    role: 'system' | 'user';
    content: string;
  }[];
}

type Env = Record<string, string | undefined>;

const DEFAULT_ANTHROPIC_COACH_MODEL = 'claude-opus-4-8';
const DEFAULT_ANTHROPIC_VOICE_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MOONSHOT_MODEL = 'kimi-k2.6';
const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let anthropicClient: Anthropic | null = null;
let anthropicClientKey: string | undefined;

function normalizeProvider(provider: string | undefined, env: Env): AiProvider {
  if (provider === 'anthropic' || provider === 'moonshot' || provider === 'openrouter') {
    return provider;
  }
  if (env.OPENROUTER_API_KEY) return 'openrouter';
  if (env.MOONSHOT_API_KEY && !env.ANTHROPIC_API_KEY) return 'moonshot';
  return 'anthropic';
}

function envValue(env: Env, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getAiConfig(env: Env = process.env): AiConfig {
  const provider = normalizeProvider(env.AI_PROVIDER?.trim(), env);

  if (provider === 'openrouter') {
    const model = envValue(env, 'OPENROUTER_MODEL') ?? DEFAULT_OPENROUTER_MODEL;
    return {
      provider,
      apiKey: envValue(env, 'OPENROUTER_API_KEY'),
      baseUrl: envValue(env, 'OPENROUTER_BASE_URL') ?? DEFAULT_OPENROUTER_BASE_URL,
      models: {
        coach: envValue(env, 'OPENROUTER_COACH_MODEL') ?? model,
        voice: envValue(env, 'OPENROUTER_VOICE_MODEL') ?? model,
        chat: envValue(env, 'OPENROUTER_CHAT_MODEL') ?? model,
        judge: envValue(env, 'OPENROUTER_JUDGE_MODEL') ?? model,
        brief: envValue(env, 'OPENROUTER_BRIEF_MODEL') ?? model,
      },
    };
  }

  if (provider === 'moonshot') {
    const model = envValue(env, 'MOONSHOT_MODEL') ?? DEFAULT_MOONSHOT_MODEL;
    return {
      provider,
      apiKey: envValue(env, 'MOONSHOT_API_KEY'),
      baseUrl: envValue(env, 'MOONSHOT_BASE_URL') ?? DEFAULT_MOONSHOT_BASE_URL,
      models: {
        coach: envValue(env, 'MOONSHOT_COACH_MODEL') ?? model,
        voice: envValue(env, 'MOONSHOT_VOICE_MODEL') ?? model,
        chat: envValue(env, 'MOONSHOT_CHAT_MODEL') ?? model,
        judge: envValue(env, 'MOONSHOT_JUDGE_MODEL') ?? model,
        brief: envValue(env, 'MOONSHOT_BRIEF_MODEL') ?? model,
      },
    };
  }

  const model = envValue(env, 'ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_COACH_MODEL;
  return {
    provider,
    apiKey: envValue(env, 'ANTHROPIC_API_KEY'),
    baseUrl: undefined,
    models: {
      coach: envValue(env, 'ANTHROPIC_COACH_MODEL') ?? model,
      voice: envValue(env, 'ANTHROPIC_VOICE_MODEL') ?? DEFAULT_ANTHROPIC_VOICE_MODEL,
      chat: envValue(env, 'ANTHROPIC_CHAT_MODEL') ?? model,
      judge: envValue(env, 'ANTHROPIC_JUDGE_MODEL') ?? model,
      brief: envValue(env, 'ANTHROPIC_BRIEF_MODEL') ?? model,
    },
  };
}

export function isAiConfigured(config = getAiConfig()): boolean {
  return Boolean(config.apiKey);
}

export function aiProviderLabel(config = getAiConfig()): string {
  if (config.provider === 'moonshot') return 'Moonshot';
  if (config.provider === 'openrouter') return 'OpenRouter';
  return 'Anthropic';
}

export function missingApiKeyMessage(config = getAiConfig()): string {
  if (config.provider === 'moonshot') {
    return 'AI features need MOONSHOT_API_KEY in .env — get a key from the Kimi Open Platform.';
  }
  if (config.provider === 'openrouter') {
    return 'AI features need OPENROUTER_API_KEY in .env — get a key at openrouter.ai/settings/keys.';
  }
  return 'AI features need ANTHROPIC_API_KEY in .env — get a key at console.anthropic.com.';
}

export function invalidApiKeyMessage(config = getAiConfig()): string {
  if (config.provider === 'moonshot') {
    return 'Moonshot API key is invalid — check MOONSHOT_API_KEY in .env.';
  }
  if (config.provider === 'openrouter') {
    return 'OpenRouter API key is invalid — check OPENROUTER_API_KEY in .env.';
  }
  return 'Anthropic API key is invalid — check ANTHROPIC_API_KEY in .env.';
}

export function isAiAuthenticationError(err: unknown): boolean {
  return (
    err instanceof Anthropic.AuthenticationError ||
    (err instanceof AiProviderError && err.kind === 'auth')
  );
}

export function isAiRateLimitError(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    (err instanceof AiProviderError && err.kind === 'rate_limit')
  );
}

export function isAiApiError(err: unknown): boolean {
  return err instanceof Anthropic.APIError || err instanceof AiProviderError;
}

export function getAnthropicClient(config = getAiConfig()): Anthropic {
  if (!anthropicClient || anthropicClientKey !== config.apiKey) {
    anthropicClient = new Anthropic({ apiKey: config.apiKey });
    anthropicClientKey = config.apiKey;
  }
  return anthropicClient;
}

/** Pull the outermost JSON object out of a model response. Reasoning models
 * routed by `openrouter/free` prepend their chain of thought ("Okay, the user
 * is…") or wrap the payload in ```json fences despite being told not to, and
 * both make JSON.parse fail on otherwise-valid output. String-aware so a brace
 * inside a headline doesn't end the scan early. Returns the input unchanged
 * when there is no balanced object to find. */
export function extractJsonObject(content: string): string {
  const start = content.indexOf('{');
  if (start === -1) return content;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const char = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return content.slice(start, i + 1);
  }
  return content;
}

export function parseJsonObjectContent<T>(
  content: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(content));
  } catch {
    // Say *how* it was invalid: a fenced/prefixed payload and a response cut
    // off mid-token are the same message otherwise, and they need opposite fixes.
    const head = content.slice(0, 80).replace(/\s+/g, ' ');
    const tail = content.slice(-80).replace(/\s+/g, ' ');
    throw new Error(
      `${label} returned invalid JSON (${content.length} chars; starts "${head}"; ends "${tail}")`,
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Name the offending fields: callers surface this to the user, and the
    // synthesis retry feeds it back to the model as the correction hint.
    const detail = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${label} did not match the expected schema (${detail})`);
  }
  return result.data;
}

function moonshotSystemPrompt(system: string, jsonInstruction: string): string {
  return `${system}

## JSON output contract
Return only a valid JSON object. Do not include markdown fences or prose outside the JSON.
${jsonInstruction}`;
}

export function moonshotThinkingParam(model: string): { type: 'disabled' } | undefined {
  if (/^kimi-k2\.(5|6)\b/.test(model)) {
    return { type: 'disabled' };
  }
  return undefined;
}

export function buildMoonshotJsonRequestBody<T>(
  request: StructuredObjectRequest<T>,
  config: AiConfig,
): MoonshotJsonRequestBody {
  const model = config.models[request.feature];
  // `reasoning` is OpenRouter's parameter; Moonshot's native API speaks
  // `thinking` and 400s on the other one.
  const reasoning =
    config.provider === 'openrouter' && request.reasoningEffort
      ? { effort: request.reasoningEffort }
      : undefined;
  return {
    model,
    max_tokens: request.maxTokens,
    response_format: { type: 'json_object' },
    ...(moonshotThinkingParam(model) ? { thinking: moonshotThinkingParam(model) } : {}),
    ...(reasoning ? { reasoning } : {}),
    messages: [
      {
        role: 'system',
        content: moonshotSystemPrompt(request.system, request.jsonInstruction),
      },
      { role: 'user', content: request.user },
    ],
  };
}

async function createMoonshotJsonObject<T>(
  request: StructuredObjectRequest<T>,
  config: AiConfig,
): Promise<T> {
  if (!config.apiKey || !config.baseUrl) {
    throw new Error(missingApiKeyMessage(config));
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildMoonshotJsonRequestBody(request, config)),
  });

  if (response.status === 401 || response.status === 403) {
    throw new AiProviderError(invalidApiKeyMessage(config), response.status, 'auth');
  }
  if (response.status === 429) {
    throw new AiProviderError(
      'Rate limited by the API — try again in a minute',
      response.status,
      'rate_limit',
      parseRetryAfter(response.headers.get('retry-after')),
    );
  }
  if (!response.ok) {
    const message = await response.text();
    throw new AiProviderError(
      `${aiProviderLabel(config)} API error (${response.status}): ${message || response.statusText}`,
      response.status,
      'api',
    );
  }

  const body = (await response.json()) as {
    choices?: {
      message?: { content?: string | null; reasoning?: string | null };
      finish_reason?: string | null;
    }[];
    error?: { message?: string; code?: number };
  };
  const choice = body.choices?.[0];
  const content = choice?.message?.content;

  // Check the budget BEFORE the content check. A reasoning model that overruns
  // returns content:null *and* finish_reason:"length"; testing content first
  // reported it as "returned no content", which hides the one detail that
  // identifies the fix (raise maxTokens, or reason less).
  if (choice?.finish_reason === 'length') {
    const reasoned = choice.message?.reasoning?.length
      ? `, having spent the budget on reasoning (${choice.message.reasoning.length} chars)`
      : '';
    throw new AiTruncatedError(
      `${request.label} hit the ${request.maxTokens}-token cap before returning JSON${reasoned}`,
    );
  }

  if (!content) {
    // OpenRouter answers 200 with an `error` object and no choices for
    // provider-side failures; that message is the only clue to what broke.
    const detail = body.error?.message
      ?? (choice ? `finish_reason=${choice.finish_reason ?? 'unknown'}` : 'no choices returned');
    throw new Error(`${request.label} returned no content (${detail})`);
  }

  return parseJsonObjectContent(content, request.schema, request.label);
}

/** A response that ran out of token budget before the model finished. Distinct
 * from AiProviderError because it is *deterministic*: the same prompt reasons
 * past the same cap on every attempt, so retrying only multiplies the wait.
 * Observed live on z-ai/glm-5.3-flash, which spent all 8000 brief tokens on
 * `reasoning` and returned content:null with finish_reason:"length". */
export class AiTruncatedError extends Error {}

export function isAiTruncationError(err: unknown): boolean {
  return err instanceof AiTruncatedError;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly kind: 'auth' | 'rate_limit' | 'api',
    /** How long the provider asked us to wait, in ms, when it says so.
     * OpenRouter sends no Retry-After on its 429s, so this is usually
     * undefined and callers fall back to their own backoff. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Read a Retry-After header in either of its legal forms — delay-seconds or
 * an HTTP-date. Returns undefined when absent or unparseable, which is the
 * common case: the caller then backs off on its own schedule. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

export async function generateStructuredObject<T>(
  request: StructuredObjectRequest<T>,
): Promise<T> {
  const config = request.config ?? getAiConfig();

  if (config.provider !== 'anthropic') {
    return createMoonshotJsonObject(request, config);
  }

  const response = await getAnthropicClient(config).messages.parse({
    model: config.models[request.feature],
    max_tokens: request.maxTokens,
    ...(request.thinking ? { thinking: request.thinking } : {}),
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: request.user }],
    output_config: { format: zodOutputFormat(request.schema) },
  });

  if (!response.parsed_output) {
    throw new Error(`${request.label} returned no parseable output`);
  }

  return response.parsed_output;
}
