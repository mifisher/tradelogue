'use server';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { z } from 'zod';
import { readEnvFile, writeEnvUpdates } from './env-file';
import { isSecretKey, maskSecret, validateUpdates } from './keys';
import { describeAiError, describeError, type TestResult } from './test-result';
import {
  generateStructuredObject,
  getAiConfig,
  type AiConfig,
  type AiProvider,
} from '@/lib/ai/provider';
import { fetchFlexStatement } from '@/lib/flex-client';

const run = promisify(execFile);

export interface SetupValues {
  values: Record<string, string>;
  /** Keys whose value in `values` is a mask, not the real thing. The form drops
   * these from the payload unless the user actually edits the field. */
  masked: string[];
}

/** Reads the .env FILE, not process.env. The file is what the user is editing;
 * process.env is what the running process loaded at boot, and between a save
 * and the restart those two legitimately disagree. */
export async function loadSetupValues(): Promise<SetupValues> {
  const raw = await readEnvFile();
  const values: Record<string, string> = {};
  const masked: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (isSecretKey(key) && value) {
      values[key] = maskSecret(value);
      masked.push(key);
    } else {
      values[key] = value;
    }
  }
  return { values, masked };
}

export async function saveSetup(updates: Record<string, string>): Promise<void> {
  await writeEnvUpdates(validateUpdates(updates));
}

export async function testDatabase(
  url: string,
): Promise<TestResult & { schemaReady: boolean }> {
  if (!url.trim()) {
    return { ok: false, schemaReady: false, message: 'Enter a connection string first.' };
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    // to_regclass answers null rather than raising for a missing table, so one
    // round trip distinguishes "wrong url" from "right url, not migrated yet".
    const result = await pool.query<{ table: string | null }>(
      "select to_regclass('public.executions') as table",
    );
    const schemaReady = result.rows[0]?.table !== null;
    return {
      ok: true,
      schemaReady,
      message: schemaReady
        ? 'Connected, and the schema is already in place.'
        : 'Connected. The schema has not been created yet — use the button below.',
    };
  } catch (err) {
    return { ...describeError(err, 'Could not connect to Postgres.'), schemaReady: false };
  } finally {
    await pool.end().catch(() => {});
  }
}

const PingSchema = z.object({ ok: z.boolean() });

function testConfig(provider: string, apiKey: string, model: string): AiConfig {
  // Build the config from the form rather than the environment, so the test
  // exercises what the user just typed — before any restart has happened.
  const base = getAiConfig({ AI_PROVIDER: provider });
  const slot = model.trim() || base.models.coach;
  return {
    provider: provider as AiProvider,
    apiKey: apiKey.trim(),
    baseUrl: base.baseUrl,
    models: { coach: slot, voice: slot, chat: slot, judge: slot, brief: slot },
  };
}

export async function testAi(input: {
  provider: string;
  apiKey: string;
  model: string;
}): Promise<TestResult> {
  if (!input.apiKey.trim()) return { ok: false, message: 'Enter an API key first.' };

  const config = testConfig(input.provider, input.apiKey, input.model);
  try {
    // A real round trip rather than an auth-only probe: this is the cheapest
    // request that proves the key, the model name, and the base URL together,
    // which is the combination that actually fails in practice.
    await generateStructuredObject({
      feature: 'coach',
      system: 'You return JSON and nothing else.',
      user: 'Return exactly {"ok": true}.',
      maxTokens: 256,
      schema: PingSchema,
      jsonInstruction: 'Return {"ok": true}.',
      label: 'Setup connection test',
      config,
    });
    return { ok: true, message: `Key works, and ${config.models.coach} answered.` };
  } catch (err) {
    return describeAiError(err, config);
  }
}

export async function testIbkr(input: {
  token: string;
  queryId: string;
}): Promise<TestResult> {
  if (!input.token.trim() || !input.queryId.trim()) {
    return { ok: false, message: 'Enter both a token and a query ID first.' };
  }
  try {
    const xml = await fetchFlexStatement({
      token: input.token.trim(),
      queryId: input.queryId.trim(),
      maxAttempts: 2,
      delayMs: 3000,
    });
    return {
      ok: true,
      message: `IBKR returned a statement (${Math.round(xml.length / 1024)} KB).`,
    };
  } catch (err) {
    // FlexError messages are already written for a trader reading them under
    // the button, so they pass through untouched.
    return describeError(err, 'Could not reach the IBKR Flex Web Service.');
  }
}

export async function testTavily(apiKey: string): Promise<TestResult> {
  if (!apiKey.trim()) return { ok: false, message: 'Enter an API key first.' };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ query: 'market open', max_results: 1 }),
    });
    if (!res.ok) {
      return { ok: false, message: `Tavily rejected the key (${res.status}).` };
    }
    return { ok: true, message: 'Tavily key works.' };
  } catch (err) {
    return describeError(err, 'Could not reach Tavily.');
  }
}

export async function testFinnhub(apiKey: string): Promise<TestResult> {
  if (!apiKey.trim()) return { ok: false, message: 'Enter an API key first.' };
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=SPY&token=${encodeURIComponent(apiKey.trim())}`,
    );
    if (!res.ok) {
      return { ok: false, message: `Finnhub rejected the key (${res.status}).` };
    }
    return { ok: true, message: 'Finnhub key works.' };
  } catch (err) {
    return describeError(err, 'Could not reach Finnhub.');
  }
}

export async function runMigrations(
  databaseUrl: string,
): Promise<{ ok: boolean; output: string }> {
  // The url is passed explicitly because process.env still holds whatever was
  // loaded at boot — which, on a first run, is nothing.
  const env = { ...process.env, DATABASE_URL: databaseUrl.trim() };
  const opts = { cwd: process.cwd(), env, timeout: 120_000 };
  try {
    // execFile buffers rather than streams. These two commands are short and
    // the user needs the output only when something fails, so a live stream
    // would cost a second channel for no gain.
    const push = await run('npm', ['run', 'db:push'], opts);
    const seed = await run('npm', ['run', 'seed:setups'], opts);
    return { ok: true, output: `${push.stdout}\n${seed.stdout}`.trim() };
  } catch (err) {
    const detail = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: (detail.stderr || detail.stdout || detail.message || 'Migration failed').trim(),
    };
  }
}
