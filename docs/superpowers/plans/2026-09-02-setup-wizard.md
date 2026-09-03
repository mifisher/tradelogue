# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh clone of Tradelogue renders a setup wizard instead of a stack trace, and every credential the app needs can be entered, verified, and saved through the UI.

**Architecture:** `.env` stays the single source of truth; the wizard writes to it through an allowlisted upsert, so the CLI scripts and launchd jobs keep reading the same file. Configuration state is derived from `process.env` only, never the database, because the database may not exist yet. The root layout renders the wizard in place of `children` when `DATABASE_URL` is absent.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, drizzle-orm + node-postgres, zod 4, vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-02-onboarding-setup-flow-design.md`

## Global Constraints

- **No new dependencies.** Everything needed is already installed: `zod`, `pg`, `dotenv`, `next`, `vitest`.
- **No React component tests.** `vitest.config.ts` sets `environment: 'node'` and the repo has no `@testing-library/react` or `jsdom`. Adding them is out of scope. Logic that needs testing gets extracted into a plain `.ts` module; components are verified with `npx tsc --noEmit`, `npm run lint`, and the manual browser steps each UI task lists.
- **Every setup function takes `env` as a parameter**, defaulting to `process.env`. `vitest.config.ts` pins `NEXT_PUBLIC_TRADING_TIMEZONE`, `RULE_OUTLAY_CAP`, `RULE_REENTRY_PAUSE_MIN`, `RULE_CIRCUIT_BREAKER`, `RULE_CHOP_TRADE_CAP`, and `RULE_SESSION_OPEN_HOUR`, so tests that read the ambient `process.env` would assert against the developer's own machine.
- **Tests are colocated** as `<module>.test.ts` next to the module, matching every existing test in `src/lib/`.
- **Never write an env key that is not on the allowlist.** The browser is a trust boundary even on localhost; `validateUpdates` (Task 3) is the gate and must not be bypassed.
- **Secrets are never returned to the client unmasked.**
- **Type of `Env` throughout:** `Record<string, string | undefined>`, matching the existing `Env` type in `src/lib/ai/provider.ts:36`.
- **Commit after every task.** Branch is `setup-wizard`.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/index.ts` *(modify)* | Lazy connection so a missing `DATABASE_URL` throws at query time, not import time |
| `src/lib/setup/env-file.ts` | Generic `.env` parse and upsert mechanics. Knows nothing about Tradelogue's keys |
| `src/lib/setup/keys.ts` | App policy: which keys are writable, which are secret, how a secret is masked |
| `src/lib/setup/state.ts` | Which of the five setup areas are configured, derived from env |
| `src/lib/setup/actions.ts` | Server actions: load, save, the five connection tests, migrations |
| `src/app/api/setup/status/route.ts` | `GET` endpoint the client polls across a dev-server restart |
| `src/lib/setup/use-setup-status.ts` | Client hook wrapping the restart poll |
| `src/components/setup/field.tsx` | `Section`, `Field`, `TestButton` primitives shared by every section |
| `src/components/setup/*-section.tsx` | One component per setup area, used by both the wizard and settings |
| `src/components/setup/setup-wizard.tsx` | Step ordering, progress, and the "next" flow |
| `src/app/setup/page.tsx`, `src/app/settings/page.tsx` | The two routes |
| `src/app/layout.tsx` *(modify)*, `src/app/error.tsx`, `src/components/nav.tsx` *(modify)* | The gate and its fallbacks |

---

### Task 1: Lazy database handle

The prerequisite for everything else. `src/db/index.ts` currently throws while the
module is being evaluated, so the root layout — which imports it transitively —
cannot render a setup page at all.

**Files:**
- Modify: `src/db/index.ts`
- Test: `src/db/index.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `db` (unchanged import shape, every existing caller keeps working);
  `class DatabaseNotConfiguredError extends Error`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/index.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';

// src/db/index.ts imports 'dotenv/config' for the CLI scripts' benefit. Without
// this, deleting DATABASE_URL below would be undone the moment the module is
// imported, because dotenv reads the developer's real .env back in — the suite
// would pass on a machine with no .env and fail on every machine with one.
vi.mock('dotenv/config', () => ({}));

const ORIGINAL = process.env.DATABASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
});

describe('db', () => {
  // The bug this guards: the previous version threw during module evaluation,
  // so importing anything that touched the database crashed the whole route
  // tree before a setup page could render.
  it('imports without a DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    await expect(import('./index')).resolves.toBeDefined();
  });

  it('throws a named, catchable error when a query is attempted unconfigured', async () => {
    delete process.env.DATABASE_URL;
    const { db, DatabaseNotConfiguredError } = await import('./index');
    expect(() => db.select()).toThrow(DatabaseNotConfiguredError);
  });

  it('names the fix in the message', async () => {
    delete process.env.DATABASE_URL;
    const { db } = await import('./index');
    expect(() => db.select()).toThrow(/DATABASE_URL is not set/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/index.test.ts`
Expected: FAIL — the import itself throws `DATABASE_URL is not set`, so even the first test fails.

- [ ] **Step 3: Write the implementation**

```ts
// src/db/index.ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import 'dotenv/config';

/** Distinct from a query failure: the app is not set up yet, and the caller
 * (root layout, error boundary) should send the user to /setup rather than
 * report a broken database. */
export class DatabaseNotConfiguredError extends Error {}

let real: NodePgDatabase | null = null;

function connect(): NodePgDatabase {
  if (!process.env.DATABASE_URL) {
    // Without this, pg silently falls back to its defaults and fails much later
    // with `database "<your-username>" does not exist`, which points at nothing.
    throw new DatabaseNotConfiguredError(
      'DATABASE_URL is not set. Open http://localhost:3000 and the setup wizard ' +
        'will walk you through it, or copy the template and fill it in:\n' +
        '  cp .env.example .env',
    );
  }
  real ??= drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
  return real;
}

/** Lazy so that a missing DATABASE_URL is a catchable runtime error rather than
 * a module-evaluation crash that takes down every route including /setup. */
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const target = connect();
    const value = Reflect.get(target, prop) as unknown;
    // Drizzle's query builders are `this`-dependent; handing back an unbound
    // function reference breaks every call site.
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
```

- [ ] **Step 4: Run the new test and the whole suite**

Run: `npx vitest run src/db/index.test.ts && npm test`
Expected: the new file PASSES and the existing suite is still green.

- [ ] **Step 5: Verify the app still talks to the real database**

Run: `npm run verify:pnl`
Expected: runs against your real database exactly as before. This is the check that the Proxy binding is correct — a broken `this` would fail here, not in the unit tests.

- [ ] **Step 6: Commit**

```bash
git add src/db/index.ts src/db/index.test.ts
git commit -m "Connect to Postgres lazily so a missing DATABASE_URL is catchable

Throwing during module evaluation meant the root layout could not render
any page, including the one that would tell the user to set DATABASE_URL."
```

---

### Task 2: `.env` parse and upsert

The one piece of real parsing logic in this feature, so it carries the bulk of
the tests. Pure string functions, plus two thin filesystem wrappers.

**Files:**
- Create: `src/lib/setup/env-file.ts`
- Test: `src/lib/setup/env-file.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseEnvFile(contents: string): Record<string, string>`
  - `upsertEnvContents(contents: string, updates: Record<string, string>): string`
  - `readEnvFile(envPath?: string): Promise<Record<string, string>>`
  - `writeEnvUpdates(updates: Record<string, string>, opts?: { envPath?: string; examplePath?: string }): Promise<void>`
  - `ENV_PATH: string`, `ENV_EXAMPLE_PATH: string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/setup/env-file.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEnvFile,
  upsertEnvContents,
  readEnvFile,
  writeEnvUpdates,
} from './env-file';

const SAMPLE = `# A comment worth keeping
DATABASE_URL=postgresql://trader:trader@localhost:5432/tradelogue

# ── AI provider ──
OPENROUTER_API_KEY=
# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
`;

describe('parseEnvFile', () => {
  it('reads keys and skips comments and blanks', () => {
    expect(parseEnvFile(SAMPLE)).toEqual({
      DATABASE_URL: 'postgresql://trader:trader@localhost:5432/tradelogue',
      OPENROUTER_API_KEY: '',
    });
  });

  it('strips surrounding quotes', () => {
    expect(parseEnvFile('K="a value"')).toEqual({ K: 'a value' });
  });

  // Matches how dotenv itself loads the file, which is what actually populates
  // process.env at boot — diverging here would mean the wizard shows one value
  // and the app uses another.
  it('drops an inline comment from an unquoted value but keeps it inside quotes', () => {
    expect(parseEnvFile('K=value # trailing')).toEqual({ K: 'value' });
    expect(parseEnvFile('K="value # kept"')).toEqual({ K: 'value # kept' });
  });
});

describe('upsertEnvContents', () => {
  it('replaces an existing key in place, leaving everything else alone', () => {
    const out = upsertEnvContents(SAMPLE, { OPENROUTER_API_KEY: 'sk-or-abc' });
    expect(out).toContain('OPENROUTER_API_KEY=sk-or-abc');
    expect(out).toContain('# A comment worth keeping');
    expect(out).toContain('DATABASE_URL=postgresql://trader:trader@localhost:5432/tradelogue');
    expect(out.match(/^OPENROUTER_API_KEY=/gm)).toHaveLength(1);
  });

  it('uncomments a commented-out key rather than appending a duplicate', () => {
    const out = upsertEnvContents(SAMPLE, { OPENROUTER_BASE_URL: 'https://example.test/v1' });
    expect(out).toContain('OPENROUTER_BASE_URL=https://example.test/v1');
    expect(out).not.toContain('# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1');
    expect(out.match(/OPENROUTER_BASE_URL=/gm)).toHaveLength(1);
  });

  it('appends a key that is absent entirely', () => {
    const out = upsertEnvContents(SAMPLE, { FINNHUB_API_KEY: 'fh-1' });
    expect(out).toMatch(/FINNHUB_API_KEY=fh-1\n$/);
  });

  // A '#' in a value is the case that silently truncates if it is written bare:
  // dotenv would read everything before the '#' and the key would look wrong
  // for no visible reason.
  it('quotes a value containing a comment character so it survives a round trip', () => {
    const out = upsertEnvContents(SAMPLE, { DATABASE_URL: 'postgresql://u:p#1@localhost/db' });
    expect(parseEnvFile(out).DATABASE_URL).toBe('postgresql://u:p#1@localhost/db');
  });

  it('quotes a value containing whitespace', () => {
    expect(parseEnvFile(upsertEnvContents(SAMPLE, { K: 'two words' })).K).toBe('two words');
  });

  it('escapes an embedded double quote', () => {
    expect(parseEnvFile(upsertEnvContents(SAMPLE, { K: 'a"b' })).K).toBe('a"b');
  });

  it('writes an empty value as a bare assignment', () => {
    expect(upsertEnvContents(SAMPLE, { OPENROUTER_API_KEY: '' })).toContain('OPENROUTER_API_KEY=\n');
  });

  it('applies several updates at once', () => {
    const parsed = parseEnvFile(
      upsertEnvContents(SAMPLE, { OPENROUTER_API_KEY: 'a', FINNHUB_API_KEY: 'b' }),
    );
    expect(parsed).toMatchObject({ OPENROUTER_API_KEY: 'a', FINNHUB_API_KEY: 'b' });
  });
});

describe('writeEnvUpdates', () => {
  it('seeds from the example template when .env does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');
    const examplePath = join(dir, '.env.example');
    await writeFile(examplePath, SAMPLE);

    await writeEnvUpdates({ OPENROUTER_API_KEY: 'sk-or-abc' }, { envPath, examplePath });

    const written = await readFile(envPath, 'utf8');
    // The point of seeding: the user inherits the template's comments rather
    // than a bare key dump they cannot navigate later.
    expect(written).toContain('# A comment worth keeping');
    expect(written).toContain('OPENROUTER_API_KEY=sk-or-abc');
  });

  it('writes the file owner-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, SAMPLE);

    await writeEnvUpdates({ OPENROUTER_API_KEY: 'sk-or-abc' }, { envPath, examplePath: join(dir, '.env.example') });

    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
  });

  it('round-trips through readEnvFile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, SAMPLE);

    await writeEnvUpdates({ FINNHUB_API_KEY: 'fh-1' }, { envPath, examplePath: join(dir, '.env.example') });

    expect(await readEnvFile(envPath)).toMatchObject({ FINNHUB_API_KEY: 'fh-1' });
  });

  it('starts an empty file when neither .env nor the template exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradelogue-env-'));
    const envPath = join(dir, '.env');

    await writeEnvUpdates({ FINNHUB_API_KEY: 'fh-1' }, { envPath, examplePath: join(dir, '.env.example') });

    expect(await readEnvFile(envPath)).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/setup/env-file.test.ts`
Expected: FAIL — `Cannot find module './env-file'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/setup/env-file.ts
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

export const ENV_PATH = join(process.cwd(), '.env');
export const ENV_EXAMPLE_PATH = join(process.cwd(), '.env.example');

const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const COMMENTED_ASSIGNMENT = /^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Read a single value the way dotenv does, so the wizard never shows a value
 * that differs from the one the running process actually loaded. */
function readValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  // Unquoted values end at an inline comment; quoted ones keep the '#'.
  const hash = trimmed.indexOf('#');
  return (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
}

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = ASSIGNMENT.exec(line);
    if (match) out[match[1]] = readValue(match[2]);
  }
  return out;
}

/** Quote only when the bare form would not survive a re-read. A '#' is the
 * dangerous one: written bare, dotenv truncates the value at it. */
function writeValue(value: string): string {
  if (value === '') return '';
  if (/^[A-Za-z0-9_\-./:@+,=?&%[\]~]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function upsertEnvContents(
  contents: string,
  updates: Record<string, string>,
): string {
  const lines = contents.split('\n');
  const pending = new Set(Object.keys(updates));

  const replaceFirst = (test: (line: string) => boolean, key: string) => {
    const index = lines.findIndex(test);
    if (index === -1) return false;
    lines[index] = `${key}=${writeValue(updates[key])}`;
    return true;
  };

  for (const key of Object.keys(updates)) {
    const assigned = (line: string) => ASSIGNMENT.exec(line)?.[1] === key;
    const commented = (line: string) => COMMENTED_ASSIGNMENT.exec(line)?.[1] === key;
    if (replaceFirst(assigned, key) || replaceFirst(commented, key)) pending.delete(key);
  }

  if (pending.size > 0) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    for (const key of pending) lines.push(`${key}=${writeValue(updates[key])}`);
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readEnvFile(envPath: string = ENV_PATH): Promise<Record<string, string>> {
  return parseEnvFile((await readIfPresent(envPath)) ?? '');
}

export async function writeEnvUpdates(
  updates: Record<string, string>,
  opts: { envPath?: string; examplePath?: string } = {},
): Promise<void> {
  const envPath = opts.envPath ?? ENV_PATH;
  const examplePath = opts.examplePath ?? ENV_EXAMPLE_PATH;

  // Seeding from the template means a first-time user ends up with the
  // annotated file the README describes, not a bare list of keys.
  const base =
    (await readIfPresent(envPath)) ?? (await readIfPresent(examplePath)) ?? '';

  await writeFile(envPath, upsertEnvContents(base, updates), { mode: 0o600 });
  await chmod(envPath, 0o600); // An existing file keeps its old mode without this.
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/setup/env-file.test.ts`
Expected: PASS, all 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setup/env-file.ts src/lib/setup/env-file.test.ts
git commit -m "Add .env parse and upsert used by the setup wizard

Reads values the way dotenv does so the wizard cannot display a value
that differs from the one the process actually loaded, and quotes on
write so a '#' in a connection string is not silently truncated."
```

---

### Task 3: Writable key allowlist and secret masking

App policy, kept separate from the generic file mechanics in Task 2. The
allowlist is the trust boundary: the browser posts key/value pairs and without
it, any environment variable could be written.

**Files:**
- Create: `src/lib/setup/keys.ts`
- Test: `src/lib/setup/keys.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `WRITABLE_KEYS: readonly string[]`
  - `SECRET_KEYS: ReadonlySet<string>`
  - `isSecretKey(key: string): boolean`
  - `maskSecret(value: string): string`
  - `validateUpdates(updates: Record<string, unknown>): Record<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/setup/keys.test.ts
import { describe, it, expect } from 'vitest';
import { WRITABLE_KEYS, isSecretKey, maskSecret, validateUpdates } from './keys';

describe('validateUpdates', () => {
  it('passes through allowlisted keys', () => {
    expect(validateUpdates({ FINNHUB_API_KEY: 'fh-1' })).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });

  // The browser is a trust boundary even on localhost: without the allowlist,
  // a crafted request could write PATH or NODE_OPTIONS into the file the app
  // and every CLI script source at boot.
  it('rejects a key that is not on the allowlist', () => {
    expect(() => validateUpdates({ NODE_OPTIONS: '--inspect' })).toThrow(/not a Tradelogue setting/);
  });

  it('rejects a non-string value', () => {
    expect(() => validateUpdates({ FINNHUB_API_KEY: 42 })).toThrow(/must be text/);
  });

  it('rejects a value containing a newline, which would forge extra keys', () => {
    expect(() => validateUpdates({ FINNHUB_API_KEY: 'a\nPATH=/evil' })).toThrow(/single line/);
  });

  it('trims surrounding whitespace, which is the usual copy-paste damage', () => {
    expect(validateUpdates({ FINNHUB_API_KEY: '  fh-1  ' })).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });

  it('allows an empty value so a key can be cleared', () => {
    expect(validateUpdates({ FINNHUB_API_KEY: '' })).toEqual({ FINNHUB_API_KEY: '' });
  });
});

describe('WRITABLE_KEYS', () => {
  it('covers every field the wizard collects', () => {
    for (const key of [
      'DATABASE_URL',
      'NEXT_PUBLIC_TRADING_TIMEZONE',
      'AI_PROVIDER',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'OPENROUTER_COACH_MODEL',
      'OPENROUTER_VOICE_MODEL',
      'OPENROUTER_CHAT_MODEL',
      'OPENROUTER_BRIEF_MODEL',
      'OPENROUTER_JUDGE_MODEL',
      'MOONSHOT_API_KEY',
      'ANTHROPIC_API_KEY',
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
    ]) {
      expect(WRITABLE_KEYS).toContain(key);
    }
  });
});

describe('isSecretKey', () => {
  it('treats tokens and API keys as secret', () => {
    expect(isSecretKey('OPENROUTER_API_KEY')).toBe(true);
    expect(isSecretKey('IBKR_FLEX_TOKEN')).toBe(true);
    expect(isSecretKey('DATABASE_URL')).toBe(true);
  });

  it('does not treat model names or thresholds as secret', () => {
    expect(isSecretKey('OPENROUTER_MODEL')).toBe(false);
    expect(isSecretKey('RULE_OUTLAY_CAP')).toBe(false);
  });
});

describe('maskSecret', () => {
  it('shows enough of a key to recognise it without revealing it', () => {
    expect(maskSecret('sk-or-v1-0123456789abcdef')).toBe('sk-or-…cdef');
  });

  // A short value has no safe prefix to show, so show nothing.
  it('fully masks a value too short to excerpt', () => {
    expect(maskSecret('abcd')).toBe('………');
  });

  it('returns an empty string unchanged so "unset" stays visible', () => {
    expect(maskSecret('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/setup/keys.test.ts`
Expected: FAIL — `Cannot find module './keys'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/setup/keys.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/setup/keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setup/keys.ts src/lib/setup/keys.test.ts
git commit -m "Add the writable-key allowlist and secret masking for setup

The wizard posts key/value pairs from a browser into a file the app and
every CLI script source at boot, so the set of writable keys is closed
and values are rejected if they span lines."
```

---

### Task 4: Setup state

Which areas are configured. Reuses the existing provider and sync rules rather
than restating them, so "configured" here cannot drift from what the features
actually require.

**Files:**
- Create: `src/lib/setup/state.ts`
- Test: `src/lib/setup/state.test.ts`

**Interfaces:**
- Consumes: `getAiConfig`, `isAiConfigured` from `@/lib/ai/provider`
- Produces:
  - `type SetupArea = 'database' | 'timezone' | 'ai' | 'ibkr' | 'market'`
  - `interface SetupState { database: boolean; timezone: boolean; ai: boolean; ibkr: boolean; market: boolean; needsSetup: boolean; incomplete: boolean }`
  - `setupState(env?: Record<string, string | undefined>): SetupState`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/setup/state.test.ts
import { describe, it, expect } from 'vitest';
import { setupState } from './state';

const CONFIGURED = {
  DATABASE_URL: 'postgresql://trader:trader@localhost:5432/tradelogue',
  NEXT_PUBLIC_TRADING_TIMEZONE: 'America/New_York',
  AI_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'sk-or-abc',
  IBKR_FLEX_TOKEN: 'tok',
  IBKR_FLEX_QUERY_ID: '123',
  TAVILY_API_KEY: 'tv',
  FINNHUB_API_KEY: 'fh',
};

describe('setupState', () => {
  it('reports a fully configured install as done', () => {
    expect(setupState(CONFIGURED)).toEqual({
      database: true,
      timezone: true,
      ai: true,
      ibkr: true,
      market: true,
      needsSetup: false,
      incomplete: false,
    });
  });

  // needsSetup is the gate the root layout uses: without a database the app
  // cannot render anything except the wizard.
  it('flags needsSetup when there is no database url', () => {
    expect(setupState({}).needsSetup).toBe(true);
  });

  it('does not flag needsSetup once the database url is present', () => {
    expect(setupState({ DATABASE_URL: 'postgresql://localhost/x' }).needsSetup).toBe(false);
  });

  it('treats a whitespace-only value as unset', () => {
    expect(setupState({ DATABASE_URL: '   ' }).database).toBe(false);
  });

  it('reports incomplete while AI or IBKR is still missing', () => {
    const state = setupState({ DATABASE_URL: 'postgresql://localhost/x' });
    expect(state).toMatchObject({ incomplete: true, ai: false, ibkr: false });
  });

  // Mirrors syncFromIbkr, which accepts either query id.
  it('accepts either IBKR query id', () => {
    const base = { DATABASE_URL: 'postgresql://localhost/x', IBKR_FLEX_TOKEN: 'tok' };
    expect(setupState({ ...base, IBKR_TRADE_CONFIRM_QUERY_ID: '9' }).ibkr).toBe(true);
    expect(setupState({ ...base, IBKR_FLEX_QUERY_ID: '9' }).ibkr).toBe(true);
    expect(setupState(base).ibkr).toBe(false);
  });

  // Delegates to the provider module, so a key for any supported provider counts
  // and the wizard cannot disagree with what the AI features actually check.
  it('counts a key from any supported provider as AI configured', () => {
    expect(setupState({ ANTHROPIC_API_KEY: 'sk-ant' }).ai).toBe(true);
    expect(setupState({ MOONSHOT_API_KEY: 'ms', AI_PROVIDER: 'moonshot' }).ai).toBe(true);
    expect(setupState({}).ai).toBe(false);
  });

  it('requires both market keys, since the brief needs quotes and news', () => {
    expect(setupState({ TAVILY_API_KEY: 'tv' }).market).toBe(false);
    expect(setupState({ TAVILY_API_KEY: 'tv', FINNHUB_API_KEY: 'fh' }).market).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/setup/state.test.ts`
Expected: FAIL — `Cannot find module './state'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/setup/state.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/setup/state.test.ts && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setup/state.ts src/lib/setup/state.test.ts
git commit -m "Derive setup state from env, delegating to the existing checks

AI configuration reuses isAiConfigured and the IBKR rule mirrors
syncFromIbkr, so the wizard cannot report an area as ready that the
feature itself would reject."
```

---

### Task 5: Connection-test result formatting

Pure error-to-message mapping, extracted so it can be tested without a network.
The non-obvious rule lives here: a truncated AI response still proves the key
and model are good, so it must not be reported as a failure.

**Files:**
- Create: `src/lib/setup/test-result.ts`
- Test: `src/lib/setup/test-result.test.ts`

**Interfaces:**
- Consumes: `AiProviderError`, `AiTruncatedError`, `invalidApiKeyMessage` from `@/lib/ai/provider`; `FlexError` from `@/lib/flex-client`
- Produces:
  - `interface TestResult { ok: boolean; message: string }`
  - `describeAiError(err: unknown, config: AiConfig): TestResult`
  - `describeError(err: unknown, fallback: string): TestResult`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/setup/test-result.test.ts
import { describe, it, expect } from 'vitest';
import { describeAiError, describeError } from './test-result';
import { AiProviderError, AiTruncatedError, getAiConfig } from '@/lib/ai/provider';
import { FlexError } from '@/lib/flex-client';

const OPENROUTER = getAiConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-x' });

describe('describeAiError', () => {
  it('names the env var to fix when the key is rejected', () => {
    const result = describeAiError(new AiProviderError('nope', 401, 'auth'), OPENROUTER);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/OPENROUTER_API_KEY/);
  });

  // The request reached the model and the model answered — the budget ran out
  // on the way back. Reporting that as a failed key would send the user to
  // re-paste a key that was never the problem.
  it('treats a truncated response as a working key with a caveat', () => {
    const result = describeAiError(new AiTruncatedError('ran out at 256'), OPENROUTER);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/reasons past/i);
  });

  it('passes a rate limit through as a retry, not a bad key', () => {
    const result = describeAiError(new AiProviderError('slow down', 429, 'rate_limit'), OPENROUTER);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rate limit/i);
  });

  // A wrong model name is the second most common mistake after a wrong key,
  // and the provider reports it as a plain API error.
  it('surfaces the provider text for anything else', () => {
    const result = describeAiError(
      new AiProviderError('OpenRouter API error (404): no such model', 404, 'api'),
      OPENROUTER,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no such model/);
  });
});

describe('describeError', () => {
  // FlexError messages are already written for a trader to read; wrapping them
  // produced doubled-up advice in sync-actions, so they pass through verbatim.
  it('passes a FlexError through unchanged', () => {
    expect(describeError(new FlexError('IBKR is rate-limiting this token.'), 'fallback')).toEqual({
      ok: false,
      message: 'IBKR is rate-limiting this token.',
    });
  });

  it('uses an Error message when there is one', () => {
    expect(describeError(new Error('connection refused'), 'fallback').message).toBe('connection refused');
  });

  it('falls back when something without a message is thrown', () => {
    expect(describeError('weird', 'Could not connect').message).toBe('Could not connect');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/setup/test-result.test.ts`
Expected: FAIL — `Cannot find module './test-result'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/setup/test-result.ts
import {
  AiProviderError,
  AiTruncatedError,
  invalidApiKeyMessage,
  type AiConfig,
} from '@/lib/ai/provider';

export interface TestResult {
  ok: boolean;
  message: string;
}

export function describeError(err: unknown, fallback: string): TestResult {
  const message = err instanceof Error && err.message ? err.message : fallback;
  return { ok: false, message };
}

export function describeAiError(err: unknown, config: AiConfig): TestResult {
  // Truncation means the request authenticated, reached the model, and the
  // model answered — it just spent the budget thinking. That is a note about
  // model choice, not a broken key, and calling it a failure would send the
  // user back to re-paste a key that was fine.
  if (err instanceof AiTruncatedError) {
    return {
      ok: true,
      message:
        'Key works. This model reasons past a short token budget — fine for coaching, ' +
        'a poor choice for the voice slot where you are watching it fill in fields.',
    };
  }

  if (err instanceof AiProviderError) {
    if (err.kind === 'auth') return { ok: false, message: invalidApiKeyMessage(config) };
    if (err.kind === 'rate_limit') {
      return { ok: false, message: 'Rate limited by the provider — try again in a minute.' };
    }
  }

  return describeError(err, 'Could not reach the provider.');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/setup/test-result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setup/test-result.ts src/lib/setup/test-result.test.ts
git commit -m "Map connection-test failures to messages that name the fix

A truncated AI response is reported as success: the request reached the
model and got an answer, so calling it a bad key would send the user to
re-paste a key that was never the problem."
```

---

### Task 6: Server actions

Load, save, the five connection tests, and the migration runner.

Every test action takes its value **as an argument** rather than reading
`process.env`. That is what lets the whole wizard be used before any restart:
the running process still has the old (or empty) environment, but the test is
performed against what the user just typed.

**Files:**
- Create: `src/lib/setup/actions.ts`

**Interfaces:**
- Consumes: `writeEnvUpdates`, `readEnvFile` (Task 2); `validateUpdates`, `isSecretKey`, `maskSecret` (Task 3); `TestResult`, `describeAiError`, `describeError` (Task 5); `generateStructuredObject`, `getAiConfig` from `@/lib/ai/provider`; `fetchFlexStatement`, `FlexError` from `@/lib/flex-client`
- Produces:
  - `interface SetupValues { values: Record<string, string>; masked: string[] }`
  - `loadSetupValues(): Promise<SetupValues>`
  - `saveSetup(updates: Record<string, string>): Promise<void>`
  - `testDatabase(url: string): Promise<TestResult & { schemaReady: boolean }>`
  - `testAi(input: { provider: string; apiKey: string; model: string }): Promise<TestResult>`
  - `testIbkr(input: { token: string; queryId: string }): Promise<TestResult>`
  - `testTavily(apiKey: string): Promise<TestResult>`
  - `testFinnhub(apiKey: string): Promise<TestResult>`
  - `runMigrations(databaseUrl: string): Promise<{ ok: boolean; output: string }>`

- [ ] **Step 1: Write the implementation**

There is no failing-test step here: every function in this file is I/O against
Postgres, IBKR, or a model provider. The branching logic that *can* be tested
without a network was extracted into Tasks 2, 3, and 5 and is already covered.

```ts
// src/lib/setup/actions.ts
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
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Verify the whole suite is still green**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/setup/actions.ts
git commit -m "Add setup server actions for loading, saving, and verifying config

Every test takes its value as an argument rather than reading the
environment, so the wizard can verify a credential before the restart
that makes it live."
```

---

### Task 7: Status endpoint and the restart poll

Saving to `.env` makes the dev server restart itself. The client needs to know
when the new process is up and carrying the new value.

**Files:**
- Create: `src/app/api/setup/status/route.ts`
- Create: `src/lib/setup/use-setup-status.ts`

**Interfaces:**
- Consumes: `setupState`, `SetupState`, `SetupArea` (Task 4)
- Produces:
  - `GET /api/setup/status` → `SetupState` as JSON
  - `waitForSetupArea(area: SetupArea, opts?: { timeoutMs?: number }): Promise<boolean>`

- [ ] **Step 1: Write the route handler**

```ts
// src/app/api/setup/status/route.ts
import { NextResponse } from 'next/server';
import { setupState } from '@/lib/setup/state';

// A route handler rather than a server action: the client calls this
// repeatedly across a dev-server restart, and needs the requests to fail
// plainly while the server is down rather than queue.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(setupState());
}
```

- [ ] **Step 2: Write the poll helper**

```ts
// src/lib/setup/use-setup-status.ts
import type { SetupArea, SetupState } from './state';

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 20_000;

/** Wait for the server to come back carrying the value that was just saved.
 *
 * Writing .env makes the Next dev server restart, so process.env is only
 * updated on the far side of that restart. Fetches fail outright while the
 * server is down; that is expected and is not an error worth showing.
 *
 * Resolves false on timeout, which is the `next start` case — there is no
 * watcher there, so the user has to restart by hand. */
export async function waitForSetupArea(
  area: SetupArea,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/setup/status', { cache: 'no-store' });
      if (res.ok) {
        const state = (await res.json()) as SetupState;
        if (state[area]) return true;
      }
    } catch {
      // Server is mid-restart. Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
```

- [ ] **Step 3: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify the endpoint answers**

Run: `npm run dev` in one terminal, then:

```bash
curl -s http://localhost:3000/api/setup/status
```

Expected: JSON with the seven boolean fields from `SetupState`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/setup/status/route.ts src/lib/setup/use-setup-status.ts
git commit -m "Add a setup status endpoint and the restart poll that reads it

Writing .env restarts the dev server, so a saved value only becomes
visible on the far side of that restart; the poll tolerates the fetches
that fail while the server is down."
```

---

### Task 8: Form payload and shared UI primitives

The payload function is small and carries a real data-loss risk: secrets are
displayed masked, and submitting a mask back would overwrite the user's real key
with the literal string `sk-or-…cdef`. It is a pure function and it is tested.
The components around it are not, per the Global Constraints.

**Files:**
- Create: `src/lib/setup/form-payload.ts`
- Test: `src/lib/setup/form-payload.test.ts`
- Create: `src/components/setup/field.tsx`

**Interfaces:**
- Consumes: `TestResult` (Task 5); `maskSecret` (Task 3)
- Produces:
  - `setupPayload(values, initial, masked): Record<string, string>`
  - `Section`, `Field`, `SelectField`, `TestButton`, `SaveBar`, `INPUT_CLS`, `LABEL_CLS`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/setup/form-payload.test.ts
import { describe, it, expect } from 'vitest';
import { setupPayload } from './form-payload';

const INITIAL = {
  OPENROUTER_API_KEY: 'sk-or-…cdef', // as displayed: a mask, not the real key
  OPENROUTER_MODEL: 'openrouter/free',
};
const MASKED = ['OPENROUTER_API_KEY'];

describe('setupPayload', () => {
  // The one that would destroy a working install: submitting the mask writes
  // the literal string "sk-or-…cdef" over the user's real key.
  it('drops an untouched masked secret', () => {
    expect(setupPayload({ ...INITIAL }, INITIAL, MASKED)).toEqual({});
  });

  it('includes a secret the user actually retyped', () => {
    const values = { ...INITIAL, OPENROUTER_API_KEY: 'sk-or-new' };
    expect(setupPayload(values, INITIAL, MASKED)).toEqual({ OPENROUTER_API_KEY: 'sk-or-new' });
  });

  // Belt and braces: even if a field is somehow marked changed, a value that is
  // still the mask is never a real credential.
  it('never submits a value that still looks like its mask', () => {
    const values = { ...INITIAL, OPENROUTER_API_KEY: 'sk-or-…cdef' };
    expect(setupPayload(values, {}, MASKED)).toEqual({});
  });

  it('drops an unchanged plain value', () => {
    expect(setupPayload({ ...INITIAL }, INITIAL, MASKED)).not.toHaveProperty('OPENROUTER_MODEL');
  });

  it('includes a changed plain value', () => {
    const values = { ...INITIAL, OPENROUTER_MODEL: 'z-ai/glm-5.3-flash' };
    expect(setupPayload(values, INITIAL, MASKED)).toEqual({ OPENROUTER_MODEL: 'z-ai/glm-5.3-flash' });
  });

  // Clearing a field is a change the user meant, so it has to reach the file.
  it('includes a value the user cleared', () => {
    const values = { ...INITIAL, OPENROUTER_MODEL: '' };
    expect(setupPayload(values, INITIAL, MASKED)).toEqual({ OPENROUTER_MODEL: '' });
  });

  it('includes a key that was not present before', () => {
    expect(setupPayload({ FINNHUB_API_KEY: 'fh-1' }, {}, [])).toEqual({ FINNHUB_API_KEY: 'fh-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/setup/form-payload.test.ts`
Expected: FAIL — `Cannot find module './form-payload'`.

- [ ] **Step 3: Write the payload function**

```ts
// src/lib/setup/form-payload.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/setup/form-payload.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the shared components**

```tsx
// src/components/setup/field.tsx
'use client';

import { useState, useTransition } from 'react';
import type { TestResult } from '@/lib/setup/test-result';

// Matches the input styling already used by RulesManager.
export const INPUT_CLS =
  'bg-deep border border-hairline rounded-[12px] px-4 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone';
export const LABEL_CLS = 'text-[13px] uppercase tracking-wide text-stone mb-1 block';

export function Section({
  title,
  blurb,
  done,
  children,
}: {
  title: string;
  blurb?: React.ReactNode;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-elevated rounded-[20px] p-8">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="font-display text-xl text-ondark">{title}</h2>
        {done !== undefined && (
          <span
            className={`w-2 h-2 rounded-full ${done ? 'bg-gain' : 'bg-stone'}`}
            aria-label={done ? 'configured' : 'not configured'}
          />
        )}
      </div>
      {blurb && <div className="text-sm text-mute mb-6 leading-relaxed">{blurb}</div>}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  help,
  placeholder,
  secret,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: React.ReactNode;
  placeholder?: string;
  secret?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <div className="relative">
        <input
          className={INPUT_CLS}
          type={secret && !reveal ? 'password' : 'text'}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-stone hover:text-ondark"
          >
            {reveal ? 'hide' : 'show'}
          </button>
        )}
      </div>
      {help && <div className="text-[13px] text-stone mt-1.5 leading-relaxed">{help}</div>}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  help?: React.ReactNode;
}) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <select className={INPUT_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <div className="text-[13px] text-stone mt-1.5 leading-relaxed">{help}</div>}
    </div>
  );
}

/** Generic in the result type so a test that returns more than TestResult —
 * testDatabase also reports whether the schema exists — keeps that field when
 * it reaches onResult. */
export function TestButton<T extends TestResult>({
  label,
  run,
  onResult,
}: {
  label: string;
  run: () => Promise<T>;
  onResult?: (result: T) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<T | null>(null);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const next = await run();
            setResult(next);
            onResult?.(next);
          })
        }
        className="h-10 rounded-full border border-hairline px-5 text-sm font-semibold text-ondark disabled:opacity-50"
      >
        {pending ? 'Checking…' : label}
      </button>
      {result && (
        <span className={`text-[13px] ${result.ok ? 'text-gain' : 'text-loss'}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}

export function SaveBar({
  onSave,
  saving,
  message,
  fallback,
}: {
  onSave: () => void;
  saving: boolean;
  message: string | null;
  /** Lines to paste into .env by hand, shown only when writing the file failed. */
  fallback?: string | null;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="h-11 rounded-full bg-ondark px-6 font-semibold text-canvas disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-[13px] text-mute">{message}</span>}
      </div>
      {fallback && (
        <div className="space-y-2">
          <p className="text-[13px] text-stone">
            Could not write the file. Add these lines to{' '}
            <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">.env</code> yourself:
          </p>
          <pre className="rounded-[12px] bg-deep p-4 text-[12px] text-mute overflow-x-auto">
            {fallback}
          </pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/setup/form-payload.ts src/lib/setup/form-payload.test.ts src/components/setup/field.tsx
git commit -m "Add setup form primitives and the changed-fields payload

Secrets render masked, so the payload function drops any field still
carrying the mask — submitting one would write the mask string over a
working credential."
```

---

### Task 9: The save hook shared by every section

Each section is the same shape: hold a draft, work out what changed, save, wait
for the restart. That belongs in one place rather than repeated five times.

**Files:**
- Create: `src/components/setup/use-section-form.ts`

**Interfaces:**
- Consumes: `setupPayload` (Task 8); `saveSetup` (Task 6); `waitForSetupArea` (Task 7); `SetupArea` (Task 4)
- Produces: `useSectionForm(opts): { values, set, save, saving, message }`

- [ ] **Step 1: Write the hook**

```ts
// src/components/setup/use-section-form.ts
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSetup } from '@/lib/setup/actions';
import { setupPayload } from '@/lib/setup/form-payload';
import { waitForSetupArea } from '@/lib/setup/use-setup-status';
import type { SetupArea } from '@/lib/setup/state';

export function useSectionForm({
  initial,
  masked,
  area,
  onSaved,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  /** Which area to wait for after saving. Omit for a section whose values do
   * not change any area's configured/unconfigured status, such as the rule
   * thresholds. */
  area?: SetupArea;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Lines to paste into .env by hand when writing it failed. */
  const [fallback, setFallback] = useState<string | null>(null);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const payload = setupPayload(values, initial, masked);
    if (Object.keys(payload).length === 0) {
      setMessage('Nothing changed.');
      return;
    }

    setSaving(true);
    setMessage('Saving…');
    setFallback(null);
    try {
      await saveSetup(payload);
      if (!area) {
        setMessage('Saved.');
      } else {
        // The dev server restarts itself when .env changes; until it is back,
        // the value is on disk but not in the running process.
        setMessage('Saved. Waiting for the server to reload…');
        const live = await waitForSetupArea(area);
        setMessage(
          live
            ? 'Saved and live.'
            : 'Saved to .env. Restart the server for it to take effect.',
        );
      }
      onSaved?.();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save.');
      // A read-only checkout or a root-owned .env is the realistic cause, and
      // it is not something the user can fix from this page — so hand them the
      // exact lines instead of leaving them with an error and no route through.
      setFallback(
        Object.entries(payload)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
      );
    } finally {
      setSaving(false);
    }
  }

  return { values, set, save, saving, message, fallback };
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/use-section-form.ts
git commit -m "Add the shared setup section form hook

Holds the draft, submits only changed fields, and waits out the dev
server restart that makes a saved value live."
```

---

### Task 10: Database section

The only section that can run before anything else works, and the only one that
shells out.

**Files:**
- Create: `src/components/setup/database-section.tsx`

**Interfaces:**
- Consumes: `Section`, `Field`, `TestButton`, `SaveBar` (Task 8); `useSectionForm` (Task 9); `testDatabase`, `runMigrations` (Task 6)
- Produces: `<DatabaseSection initial masked done />`

- [ ] **Step 1: Write the component**

```tsx
// src/components/setup/database-section.tsx
'use client';

import { useState, useTransition } from 'react';
import { Section, Field, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testDatabase, runMigrations } from '@/lib/setup/actions';

const NATIVE = 'postgresql://trader:trader@localhost:5432/tradelogue';
// docker-compose.yml publishes 5433 so it does not fight a native install.
const DOCKER = 'postgresql://trader:trader@localhost:5433/tradelogue';

export function DatabaseSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({
    initial,
    masked,
    area: 'database',
  });
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [migrating, startMigration] = useTransition();
  const [migrationOutput, setMigrationOutput] = useState<string | null>(null);

  const url = values.DATABASE_URL ?? '';

  return (
    <Section
      title="Database"
      done={done}
      blurb={
        <>
          Tradelogue keeps everything in your own Postgres — nothing is hosted.
          Install it natively with{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">
            brew install postgresql@16
          </code>{' '}
          then{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">
            createdb -O trader tradelogue
          </code>
          , or run{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">docker compose up -d</code>{' '}
          from the repo.
        </>
      }
    >
      <Field
        label="Connection string"
        value={url}
        onChange={(v) => set('DATABASE_URL', v)}
        placeholder={NATIVE}
        secret
        help="Contains your database password, so it is stored masked."
      />

      <div className="flex gap-2 flex-wrap">
        {[
          { label: 'Use native default (5432)', value: NATIVE },
          { label: 'Use Docker default (5433)', value: DOCKER },
        ].map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => set('DATABASE_URL', preset.value)}
            className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-mute hover:text-ondark"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <TestButton
        label="Test connection"
        run={() => testDatabase(url)}
        onResult={(result) => setSchemaReady(result.ok ? result.schemaReady : null)}
      />

      {schemaReady === false && (
        <div className="space-y-3">
          <button
            type="button"
            disabled={migrating}
            onClick={() =>
              startMigration(async () => {
                const result = await runMigrations(url);
                setMigrationOutput(result.output || 'Done.');
                if (result.ok) setSchemaReady(true);
              })
            }
            className="h-10 rounded-full bg-cobalt px-5 text-sm font-semibold text-on-cobalt disabled:opacity-50"
          >
            {migrating ? 'Creating schema…' : 'Create schema & seed'}
          </button>
          <p className="text-[13px] text-stone">
            Runs <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">npm run db:push</code>{' '}
            and{' '}
            <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">npm run seed:setups</code>.
            You can run those yourself in a terminal instead.
          </p>
        </div>
      )}

      {migrationOutput && (
        <pre className="rounded-[12px] bg-deep p-4 text-[12px] text-mute overflow-x-auto max-h-64">
          {migrationOutput}
        </pre>
      )}

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/database-section.tsx
git commit -m "Add the database setup section

Distinguishes a wrong connection string from a correct one with no
schema yet, and offers the migration only in the second case."
```

---

### Task 11: Trading day section

**Files:**
- Create: `src/components/setup/trading-day-section.tsx`

**Interfaces:**
- Consumes: `Section`, `Field`, `SelectField`, `SaveBar` (Task 8); `useSectionForm` (Task 9)
- Produces: `<TradingDaySection initial masked done />`

- [ ] **Step 1: Write the component**

```tsx
// src/components/setup/trading-day-section.tsx
'use client';

import { useMemo, useState } from 'react';
import { Section, Field, SelectField, SaveBar } from './field';
import { useSectionForm } from './use-section-form';

const THRESHOLDS = [
  { key: 'RULE_OUTLAY_CAP', label: 'Max position cost ($)', help: 'contracts × entry × 100' },
  { key: 'RULE_REENTRY_PAUSE_MIN', label: 'Re-entry pause (minutes)', help: 'after a losing exit on the same name' },
  { key: 'RULE_CIRCUIT_BREAKER', label: 'Daily loss limit ($)', help: 'negative; stop opening once running P&L reaches it' },
  { key: 'RULE_CHOP_TRADE_CAP', label: 'Max trades on a chop day', help: 'on an Uncertain tape' },
  { key: 'RULE_SESSION_OPEN_HOUR', label: 'Opening-chop cutoff (hour)', help: '24h clock; 10 = the first 30 min of a 09:30 open' },
];

export function TradingDaySection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({
    initial,
    masked,
    area: 'timezone',
  });
  const [showThresholds, setShowThresholds] = useState(false);

  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const detected = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const zone = values.NEXT_PUBLIC_TRADING_TIMEZONE || detected;

  return (
    <Section
      title="Your trading day"
      done={done}
      blurb="Every session date, day boundary, and rule time is evaluated in this zone. Get it right first — if it is wrong, trades land on the wrong day and everything downstream inherits the error."
    >
      <SelectField
        label="Trading timezone"
        value={zone}
        onChange={(v) => set('NEXT_PUBLIC_TRADING_TIMEZONE', v)}
        options={zones.map((z) => ({ value: z, label: z }))}
        help={`Your browser reports ${detected}. Most US options traders want America/New_York regardless of where they sit.`}
      />

      <button
        type="button"
        onClick={() => setShowThresholds((s) => !s)}
        className="text-[13px] text-mute hover:text-ondark"
      >
        {showThresholds ? 'Hide' : 'Show'} rule thresholds
      </button>

      {showThresholds && (
        <div className="space-y-5 border-l border-hairline pl-5">
          <p className="text-[13px] text-stone leading-relaxed">
            These feed the mechanical detectors. The shipped values are round
            placeholders, not advice — set them to what you actually trade. They
            apply to whichever rule carries the matching detector.
          </p>
          {THRESHOLDS.map((t) => (
            <Field
              key={t.key}
              label={t.label}
              value={values[t.key] ?? ''}
              onChange={(v) => set(t.key, v)}
              help={t.help}
            />
          ))}
        </div>
      )}

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `Intl.supportedValuesOf` is not in the ambient types, add `"es2022"` to `compilerOptions.lib` in `tsconfig.json` — do not add a package.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/trading-day-section.tsx
git commit -m "Add the trading day setup section

Timezone first, with the rule thresholds collapsed behind it — they are
personal risk limits, not settings with a right answer."
```

---

### Task 12: AI section

**Files:**
- Create: `src/components/setup/ai-section.tsx`

**Interfaces:**
- Consumes: `Section`, `Field`, `SelectField`, `TestButton`, `SaveBar` (Task 8); `useSectionForm` (Task 9); `testAi` (Task 6)
- Produces: `<AiSection initial masked done />`

- [ ] **Step 1: Write the component**

Note the deliberate choice on model names: the recommended configuration is
offered behind a button rather than prefilled. The README is explicit that model
names go stale, and silently prefilling would make this component a second place
where stale names live.

```tsx
// src/components/setup/ai-section.tsx
'use client';

import { Section, Field, SelectField, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testAi } from '@/lib/setup/actions';

const PROVIDERS = [
  {
    value: 'openrouter',
    label: 'OpenRouter — recommended, one key reaches every model',
    keyVar: 'OPENROUTER_API_KEY',
    prefix: 'OPENROUTER',
    where: 'openrouter.ai/settings/keys',
    url: 'https://openrouter.ai/settings/keys',
  },
  {
    value: 'anthropic',
    label: 'Anthropic — direct Claude access',
    keyVar: 'ANTHROPIC_API_KEY',
    prefix: 'ANTHROPIC',
    where: 'console.anthropic.com',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    value: 'moonshot',
    label: 'Moonshot — direct Kimi access',
    keyVar: 'MOONSHOT_API_KEY',
    prefix: 'MOONSHOT',
    where: 'the Kimi Open Platform',
    url: 'https://platform.moonshot.ai/console/api-keys',
  },
];

const SLOTS = [
  { slot: 'MODEL', label: 'Default model', help: 'Used for any slot left blank below.' },
  { slot: 'VOICE_MODEL', label: 'Voice / Fill with AI', help: 'You watch this one fill in fields, so latency is the whole game. Use a fast, non-reasoning model.' },
  { slot: 'COACH_MODEL', label: 'Session coaching + patterns', help: 'Nobody watches this generate. Quality over speed; long context, so input pricing dominates.' },
  { slot: 'BRIEF_MODEL', label: 'Market brief', help: 'One long structured JSON document. Pin this — most small models mangle the schema.' },
  { slot: 'CHAT_MODEL', label: 'Chat with your journal', help: 'A tool-use loop, so it needs dependable function calling.' },
  { slot: 'JUDGE_MODEL', label: 'Eval judge', help: 'Only spent when you run the eval harness. Pick a different family from the coach, so nothing grades its own work.' },
];

// From the README's recommended starting configuration. Offered, not prefilled:
// free-tier model names turn over constantly and this should not become a
// second place where stale ones live.
const RECOMMENDED: Record<string, string> = {
  OPENROUTER_MODEL: 'openrouter/free',
  OPENROUTER_VOICE_MODEL: 'google/gemini-2.5-flash-lite',
  OPENROUTER_COACH_MODEL: 'z-ai/glm-5.3-flash',
  OPENROUTER_BRIEF_MODEL: 'z-ai/glm-5.3-flash',
  OPENROUTER_JUDGE_MODEL: 'moonshotai/kimi-k2.6',
};

export function AiSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({ initial, masked, area: 'ai' });

  const providerValue = values.AI_PROVIDER || 'openrouter';
  const provider = PROVIDERS.find((p) => p.value === providerValue) ?? PROVIDERS[0];
  const apiKey = values[provider.keyVar] ?? '';

  return (
    <Section
      title="AI"
      done={done}
      blurb="Optional — every AI feature degrades gracefully without a key, and the rest of the app is unaffected. Nothing leaves your machine except the calls you configure here."
    >
      <SelectField
        label="Provider"
        value={providerValue}
        onChange={(v) => set('AI_PROVIDER', v)}
        options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
      />

      <Field
        label="API key"
        value={apiKey}
        onChange={(v) => set(provider.keyVar, v)}
        secret
        help={
          <>
            Get one at{' '}
            <a
              href={provider.url}
              target="_blank"
              rel="noreferrer"
              className="text-cobalt underline underline-offset-2"
            >
              {provider.where}
            </a>
            . Stored in <code className="bg-deep rounded px-1 text-ondark">.env</code> on this
            machine.
          </>
        }
      />

      <TestButton
        label="Test key"
        run={() =>
          testAi({
            provider: providerValue,
            apiKey,
            model: values[`${provider.prefix}_COACH_MODEL`] || values[`${provider.prefix}_MODEL`] || '',
          })
        }
      />

      <div className="pt-2 border-t border-hairline space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
          <p className="text-[13px] text-stone leading-relaxed max-w-xl">
            Five slots, because the features want opposite things. Leave a slot
            blank to fall back to the default model. Model names go stale — the
            free tier especially — so treat any suggestion as a starting point.
          </p>
          {providerValue === 'openrouter' && (
            <button
              type="button"
              onClick={() => {
                for (const [key, value] of Object.entries(RECOMMENDED)) set(key, value);
              }}
              className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-mute hover:text-ondark shrink-0"
            >
              Use the recommended starting set
            </button>
          )}
        </div>

        {SLOTS.map((s) => {
          const key = `${provider.prefix}_${s.slot}`;
          return (
            <Field
              key={key}
              label={s.label}
              value={values[key] ?? ''}
              onChange={(v) => set(key, v)}
              help={s.help}
            />
          );
        })}
      </div>

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/ai-section.tsx
git commit -m "Add the AI provider setup section

The recommended model set is behind a button rather than prefilled:
free-tier names turn over constantly and this should not become a second
place stale ones live."
```

---

### Task 13: Interactive Brokers section

The highest-value instructions in the feature. The parser depends on three
format settings exactly, and a wrong one produces a parse failure whose cause is
invisible from the error.

**Files:**
- Create: `src/components/setup/ibkr-section.tsx`

**Interfaces:**
- Consumes: `Section`, `Field`, `TestButton`, `SaveBar` (Task 8); `useSectionForm` (Task 9); `testIbkr` (Task 6)
- Produces: `<IbkrSection initial masked done />`

- [ ] **Step 1: Write the component**

```tsx
// src/components/setup/ibkr-section.tsx
'use client';

import { Section, Field, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testIbkr } from '@/lib/setup/actions';

const FIELDS =
  'Account ID, Asset Class, Symbol, Underlying Symbol, Description, Conid, Put/Call, ' +
  'Strike, Expiry, Multiplier, Date/Time, Quantity, Trade Price, Proceeds, IB Commission, ' +
  'Buy/Sell, Transaction Type, IB Exec ID, Notes/Codes';

export function IbkrSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({ initial, masked, area: 'ibkr' });

  const token = values.IBKR_FLEX_TOKEN ?? '';
  const activityId = values.IBKR_FLEX_QUERY_ID ?? '';
  const confirmId = values.IBKR_TRADE_CONFIRM_QUERY_ID ?? '';

  return (
    <Section
      title="Interactive Brokers"
      done={done}
      blurb="Tradelogue reads your fills through the IBKR Flex Web Service, which is read-only and separate from your trading credentials. It cannot place orders."
    >
      <div className="rounded-[12px] bg-deep p-5 text-[13px] text-mute leading-relaxed space-y-3">
        <p className="text-ondark font-semibold">Creating the Flex Query</p>
        <p>
          In Client Portal → Performance &amp; Reports → Flex Queries, create an{' '}
          <span className="text-ondark">Activity Flex Query</span> (your end-of-day history) and,
          once that works, a <span className="text-ondark">Trade Confirmation Flex Query</span>{' '}
          (same-day fills, so you can journal intraday instead of waiting for the statement).
        </p>
        <p>
          For either one — <span className="text-ondark">Section:</span> Trades, with the{' '}
          <span className="text-ondark">Executions</span> option enabled.{' '}
          <span className="text-ondark">Period:</span> Last 365 Calendar Days.
        </p>
        <p>
          <span className="text-ondark">Fields:</span> {FIELDS}.
        </p>
        <p className="text-loss">
          These three are not cosmetic — the parser expects exactly this shape. Date format{' '}
          <code className="bg-canvas rounded px-1">yyyyMMdd</code>, time format{' '}
          <code className="bg-canvas rounded px-1">HHmmss</code>, date/time separator{' '}
          <code className="bg-canvas rounded px-1">;</code> (semicolon). If an import fails to
          parse, check these first.
        </p>
        <p>
          Then enable the service under Settings → FlexWeb Service and generate a token.
        </p>
      </div>

      <Field
        label="Flex token"
        value={token}
        onChange={(v) => set('IBKR_FLEX_TOKEN', v)}
        secret
        help="From Settings → FlexWeb Service. Read-only; it cannot place orders."
      />
      <Field
        label="Activity query ID"
        value={activityId}
        onChange={(v) => set('IBKR_FLEX_QUERY_ID', v)}
        help="End-of-day history — the backbone of your journal."
      />
      <Field
        label="Trade confirmation query ID (optional)"
        value={confirmId}
        onChange={(v) => set('IBKR_TRADE_CONFIRM_QUERY_ID', v)}
        help="Same-day fills. The Sync button prefers this; without it, it falls back to the activity query."
      />

      <TestButton
        label="Test connection"
        run={() => testIbkr({ token, queryId: confirmId || activityId })}
      />
      <p className="text-[13px] text-stone">
        IBKR throttles per token and its statement generation is often slow around the
        midnight-ET maintenance window. A &ldquo;try again in a minute&rdquo; here usually means
        exactly that.
      </p>

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/ibkr-section.tsx
git commit -m "Add the IBKR Flex setup section

Spells out the three format settings the parser depends on, since a
wrong one fails at parse time with no hint at the cause."
```

---

### Task 14: Market data section

**Files:**
- Create: `src/components/setup/market-section.tsx`

**Interfaces:**
- Consumes: `Section`, `Field`, `TestButton`, `SaveBar` (Task 8); `useSectionForm` (Task 9); `testTavily`, `testFinnhub` (Task 6)
- Produces: `<MarketSection initial masked done />`

- [ ] **Step 1: Write the component**

```tsx
// src/components/setup/market-section.tsx
'use client';

import { Section, Field, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testTavily, testFinnhub } from '@/lib/setup/actions';

export function MarketSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({ initial, masked, area: 'market' });

  const tavily = values.TAVILY_API_KEY ?? '';
  const finnhub = values.FINNHUB_API_KEY ?? '';

  return (
    <Section
      title="Market data"
      done={done}
      blurb="Optional — needed only for the premarket brief. The free tier of each is enough for one brief a day. Index sparklines come from keyless FRED data, so there is nothing to configure for those."
    >
      <Field
        label="Tavily API key"
        value={tavily}
        onChange={(v) => set('TAVILY_API_KEY', v)}
        secret
        help={
          <>
            News and Reddit search. Get one at{' '}
            <a href="https://app.tavily.com" target="_blank" rel="noreferrer" className="text-cobalt underline underline-offset-2">
              app.tavily.com
            </a>
            .
          </>
        }
      />
      <TestButton label="Test Tavily" run={() => testTavily(tavily)} />

      <Field
        label="Finnhub API key"
        value={finnhub}
        onChange={(v) => set('FINNHUB_API_KEY', v)}
        secret
        help={
          <>
            Quotes and the earnings calendar. Get one at{' '}
            <a href="https://finnhub.io/dashboard" target="_blank" rel="noreferrer" className="text-cobalt underline underline-offset-2">
              finnhub.io/dashboard
            </a>
            .
          </>
        }
      />
      <TestButton label="Test Finnhub" run={() => testFinnhub(finnhub)} />

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/market-section.tsx
git commit -m "Add the market data setup section"
```

---

### Task 15: Wizard, `/setup`, and `/settings`

The wizard is the five sections in order, each collapsed once it is done. A
one-at-a-time modal was considered and rejected: it hides progress, and every
section here can legitimately be skipped or revisited out of order.

**Files:**
- Create: `src/components/setup/setup-wizard.tsx`
- Create: `src/components/setup/setup-gate.tsx`
- Create: `src/app/setup/page.tsx`
- Create: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: all five section components (Tasks 10–14); `loadSetupValues` (Task 6); `setupState`, `SetupState` (Task 4); `PAGE_NARROW` from `@/lib/layout`
- Produces: `<SetupWizard values masked state />`, `<SetupGate />`, the two routes

- [ ] **Step 1: Write the wizard**

```tsx
// src/components/setup/setup-wizard.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DatabaseSection } from './database-section';
import { TradingDaySection } from './trading-day-section';
import { AiSection } from './ai-section';
import { IbkrSection } from './ibkr-section';
import { MarketSection } from './market-section';
import type { SetupState } from '@/lib/setup/state';

interface Props {
  values: Record<string, string>;
  masked: string[];
  state: SetupState;
}

export function SetupWizard({ values, masked, state }: Props) {
  const shared = { initial: values, masked };

  const steps = [
    { key: 'database', title: 'Database', required: true, done: state.database, node: <DatabaseSection {...shared} done={state.database} /> },
    { key: 'timezone', title: 'Your trading day', required: true, done: state.timezone, node: <TradingDaySection {...shared} done={state.timezone} /> },
    { key: 'ai', title: 'AI', required: false, done: state.ai, node: <AiSection {...shared} done={state.ai} /> },
    { key: 'ibkr', title: 'Interactive Brokers', required: false, done: state.ibkr, node: <IbkrSection {...shared} done={state.ibkr} /> },
    { key: 'market', title: 'Market data', required: false, done: state.market, node: <MarketSection {...shared} done={state.market} /> },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-3xl text-ondark">Set up Tradelogue</h1>
        <p className="text-mute leading-relaxed max-w-2xl">
          Everything runs on your machine, against your own Postgres, using your own API keys.
          Only the database and your timezone are required — the rest can wait, and each one
          switches on a feature rather than gating the app.
        </p>
        <p className="text-[13px] text-stone">
          {doneCount} of {steps.length} done · saved to{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">.env</code>, which is
          gitignored
        </p>
      </header>

      {steps.map((step, i) => (
        <Step key={step.key} index={i + 1} title={step.title} done={step.done} required={step.required}>
          {step.node}
        </Step>
      ))}

      {!state.needsSetup && (
        <section className="bg-elevated rounded-[20px] p-8 space-y-4">
          <h2 className="font-display text-xl text-ondark">Last thing: your rulebook</h2>
          <p className="text-mute text-sm leading-relaxed max-w-2xl">
            A fresh install seeds exactly one sample rule, to show the shape and to demonstrate a
            detector firing. Your rulebook encodes how you trade and what your account can absorb
            — someone else&rsquo;s would be worse than none.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Link href="/rules" className="h-11 inline-flex items-center rounded-full bg-ondark px-6 font-semibold text-canvas">
              Write your rules
            </Link>
            <Link href="/import" className="h-11 inline-flex items-center rounded-full border border-hairline px-6 font-semibold text-ondark">
              Import trades
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/** Done steps collapse to a one-line summary so the page stays about what is
 * left to do, without hiding what has already been set. */
function Step({
  index,
  title,
  done,
  required,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  required: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!done);

  if (!open) {
    return (
      <div className="bg-elevated rounded-[20px] px-8 py-5 flex items-center justify-between gap-4">
        <span className="text-sm text-ondark">
          <span className="text-stone mr-3">{index}</span>
          {title}
          <span className="text-gain ml-3 text-[13px]">configured</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-mute hover:text-ondark">
          change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[13px] text-stone mb-2 px-2">
        Step {index}
        {!required && ' · optional'}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write the gate wrapper and the two routes**

```tsx
// src/components/setup/setup-gate.tsx
import { loadSetupValues } from '@/lib/setup/actions';
import { setupState } from '@/lib/setup/state';
import { SetupWizard } from './setup-wizard';
import { PAGE_NARROW } from '@/lib/layout';

/** Shared by /setup and by the root layout's first-run gate, so both show the
 * same thing without the wizard being built twice. */
export async function SetupGate() {
  const { values, masked } = await loadSetupValues();
  return (
    <div className={`${PAGE_NARROW} mx-auto px-6 py-12`}>
      <SetupWizard values={values} masked={masked} state={setupState()} />
    </div>
  );
}
```

```tsx
// src/app/setup/page.tsx
import { SetupGate } from '@/components/setup/setup-gate';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  return <SetupGate />;
}
```

```tsx
// src/app/settings/page.tsx
import { loadSetupValues } from '@/lib/setup/actions';
import { setupState } from '@/lib/setup/state';
import { PAGE_NARROW } from '@/lib/layout';
import { DatabaseSection } from '@/components/setup/database-section';
import { TradingDaySection } from '@/components/setup/trading-day-section';
import { AiSection } from '@/components/setup/ai-section';
import { IbkrSection } from '@/components/setup/ibkr-section';
import { MarketSection } from '@/components/setup/market-section';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { values, masked } = await loadSetupValues();
  const state = setupState();
  const shared = { initial: values, masked };

  return (
    <div className={`${PAGE_NARROW} mx-auto px-6 py-12 space-y-6`}>
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-ondark">Settings</h1>
        <p className="text-mute text-sm leading-relaxed max-w-2xl">
          Written to <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">.env</code>. The
          dev server reloads itself when that file changes; under{' '}
          <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">next start</code> you have to
          restart it yourself, and a timezone change needs a rebuild because it is inlined at build
          time.
        </p>
      </header>

      <DatabaseSection {...shared} done={state.database} />
      <TradingDaySection {...shared} done={state.timezone} />
      <AiSection {...shared} done={state.ai} />
      <IbkrSection {...shared} done={state.ibkr} />
      <MarketSection {...shared} done={state.market} />
    </div>
  );
}
```

- [ ] **Step 3: Verify it type-checks, lints, and builds**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, then visit http://localhost:3000/settings on your configured
install. Check: every section renders; secrets show as masks (e.g. `sk-or-…cdef`);
"Test key" on the AI section reports success; pressing Save with nothing changed
says "Nothing changed" and does **not** rewrite `.env`.

Confirm your key survived: `grep OPENROUTER_API_KEY .env` should still show the
real key, not a mask.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/setup-wizard.tsx src/components/setup/setup-gate.tsx src/app/setup/page.tsx src/app/settings/page.tsx
git commit -m "Add the setup wizard and the settings page

Both render the same section components; the wizard adds ordering,
progress, and a hand-off to writing your own rulebook."
```

---

### Task 16: The gate, the error boundary, and the nav

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/error.tsx`
- Modify: `src/components/nav.tsx`

**Interfaces:**
- Consumes: `setupState` (Task 4); `SetupGate` (Task 15)
- Produces: `<Nav status incomplete />` — the added `incomplete` prop

- [ ] **Step 1: Modify the root layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/theme-provider";
import { getBriefFreshness } from "@/lib/market-brief-actions";
import { headerStatus } from "@/lib/header-status";
import { setupState } from "@/lib/setup/state";
import { SetupGate } from "@/components/setup/setup-gate";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Tradelogue",
  description: "A local-first, AI-native trading journal for options day traders",
};

/** The brief lives in the database, which may be unconfigured or unmigrated.
 * Nav already accepts a null status, so this degrades to a header without a
 * session stamp rather than taking down every route. */
async function safeStatus() {
  try {
    return headerStatus(new Date(), await getBriefFreshness());
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const state = setupState();
  const status = state.needsSetup ? null : await safeStatus();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${interTight.variable} min-h-screen antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <Nav status={status} incomplete={state.incomplete} />
          {/* No DATABASE_URL means no page can render, so every route shows the
              wizard. /setup's own page is the same component, so there is
              nothing to redirect and no loop to guard against. */}
          {state.needsSetup ? <SetupGate /> : children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add the error boundary**

```tsx
// src/app/error.tsx
'use client';

import Link from 'next/link';

/** The state this exists for: DATABASE_URL is set, so the wizard gate lets the
 * app through, but the schema has never been pushed. Without this the user
 * meets a Next.js stack trace on their first page load. */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  const databaseProblem = /DATABASE_URL|relation .* does not exist|ECONNREFUSED/i.test(
    error.message,
  );

  return (
    <main className="max-w-xl mx-auto px-6 py-16 space-y-5">
      <h1 className="font-display text-2xl text-ondark">
        {databaseProblem ? 'The database is not ready' : 'Something went wrong'}
      </h1>
      <p className="text-mute text-sm leading-relaxed">
        {databaseProblem
          ? 'Tradelogue could reach this page but not its database. The setup page can test the connection and create the schema.'
          : error.message}
      </p>
      {databaseProblem && (
        <Link
          href="/setup"
          className="h-11 inline-flex items-center rounded-full bg-ondark px-6 font-semibold text-canvas"
        >
          Open setup
        </Link>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Modify the nav**

Two edits to `src/components/nav.tsx`:

Add `{ label: 'Settings', href: '/settings' }` to the end of the `links` array.

Then change the `Nav` signature and add the pill:

```tsx
export function Nav({
  status,
  incomplete,
}: {
  status: HeaderStatus | null;
  incomplete?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-canvas/90 backdrop-blur border-b border-hairline">
      <div className={`${headerWidth(pathname)} mx-auto px-6 h-16 flex items-center justify-between gap-3`}>
        <span className="font-display text-lg sm:text-xl text-ondark whitespace-nowrap shrink-0">
          Tradelogue
        </span>
        <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map(({ label, href }) => {
            const isActive =
              href === '/' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`shrink-0 rounded-full px-3 sm:px-4 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-cobalt text-on-cobalt'
                    : 'text-mute hover:bg-elevated hover:text-ondark'
                }`}
              >
                {label}
              </Link>
            );
          })}
          {/* AI or IBKR still unconfigured: the app works, but a headline
              feature is switched off and nothing else would say so. */}
          {incomplete && !pathname.startsWith('/setup') && (
            <Link
              href="/setup"
              className="shrink-0 rounded-full border border-loss px-3 sm:px-4 py-1.5 text-sm font-semibold text-loss whitespace-nowrap"
            >
              Finish setup
            </Link>
          )}
          <ModeToggle />
        </nav>
        {status && <SessionStamp status={status} />}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Verify it type-checks, lints, and builds**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`
Expected: all green.

- [ ] **Step 5: Verify the first-run path end to end**

This is the test the whole feature exists for. Simulate a fresh clone without
touching your real `.env`:

```bash
cp .env .env.backup && mv .env .env.real && npm run dev
```

Check, at http://localhost:3000:
1. The wizard renders instead of a stack trace — and also at `/trades` and `/coach`.
2. Paste a connection string, press Test connection, see it report whether the schema exists.
3. Save, and watch the message go from "Waiting for the server to reload…" to "Saved and live."
4. Reload: the database step is collapsed and marked configured, and the rest of the app is reachable.

Then restore:

```bash
rm -f .env && mv .env.real .env && grep -c . .env
```

Confirm against `.env.backup` that nothing was lost: `diff .env .env.backup`.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/app/error.tsx src/components/nav.tsx
git commit -m "Show the setup wizard instead of crashing on a fresh clone

Without DATABASE_URL no page can render, so the layout swaps the wizard
in for every route; the error boundary covers the narrower case of a
database that is configured but not yet migrated."
```

---

### Task 17: README, and the full verification pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the Getting started section**

Replace steps 3–5 of "Getting started" with the following, leaving every other
section of the README intact — "Connecting Interactive Brokers", "Bring your own
model", "Choosing your models", and the rest stay as the standalone reference for
people reading the repo on GitHub.

```markdown
### 3. Run it

```bash
npm run dev
```

Open http://localhost:3000. On a fresh clone this is the setup wizard: it walks
you through the connection string, your timezone, your AI provider and keys, and
the IBKR Flex Query — each with a button that verifies the value before you
commit to it, and instructions on where to get it.

Everything it collects is written to `.env`, which is gitignored. You can edit
that file by hand instead if you prefer; see `.env.example` for the annotated
list, and the sections below for what each setting does. Both routes end in the
same place.

The wizard can also create the schema and seed the example setup for you. To do
that from a terminal instead:

```bash
npm run db:push && npm run seed:setups
```

Once you are running, `/settings` has the same forms for rotating a key or
swapping a model later.
```

Then add this note at the end of the "Bring your own model" section:

```markdown
Changing any of this from `/settings` writes `.env` and the dev server reloads
itself. Under `next start` there is no watcher, so restart it yourself — and a
timezone change needs a rebuild, because `NEXT_PUBLIC_TRADING_TIMEZONE` is
inlined at build time.
```

- [ ] **Step 2: Check the table of contents still matches**

The README's table of contents links to `#getting-started`. Confirm the heading
is unchanged and no removed heading is still linked.

Run: `grep -n "^#\{2,3\} " README.md`
Expected: every anchor in the table of contents corresponds to a heading that still exists.

- [ ] **Step 3: Full verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green. Record the actual test count in the commit message rather
than assuming it.

- [ ] **Step 4: Confirm the CLI path is untouched**

The whole point of writing `.env` rather than a settings table is that nothing
else had to change. Prove it:

```bash
npm run verify:pnl && npm run import:flex
```

Expected: both behave exactly as they did before this branch.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Point the README's getting started at the setup wizard

Keeps the hand-editing path documented — the wizard writes the same
.env, so both routes end in the same place."
```

---

## Open decisions

These were flagged when the spec was written and were not overridden, so they
are implemented as specified. Each is cheap to reverse:

1. **Migrations run from the browser** (Task 10). To drop it, delete
   `runMigrations` from `src/lib/setup/actions.ts` and the button in
   `database-section.tsx`, leaving the command text that is already beside it.
2. **The wizard ends at `/rules`** (Task 15) rather than the dashboard, on the
   grounds that the one seeded sample rule is a demonstration and not a default.
3. **Recommended model names are offered behind a button** (Task 12) rather than
   prefilled, so this component does not become a second place stale model names
   live.

---

## Deviations found during execution

Recorded here rather than silently folded in, because both were found by
verification steps and both changed the design.

1. **Masked secrets broke every connection test** (found at Task 15, Step 4).
   Secrets reach the browser masked, and the test buttons sent that mask
   straight to the provider. `testDatabase` handed `postgr…ogue` to `pg`, which
   parsed the mask's middle as a hostname and reported
   `getaddrinfo ENOTFOUND base` — a message that reads like a broken database
   rather than an untouched field. The same would have hit the AI, IBKR,
   Tavily, and Finnhub tests.

   Fixed by adding `resolveSecret(key, provided)` to `actions.ts`: a value that
   is empty or still carries the mask character falls back to what is already
   in `.env`, server-side. `MASK_CHAR` and `isMaskedValue` moved into `keys.ts`
   so `form-payload.ts` and `actions.ts` share one definition instead of two,
   and `keys.test.ts` gained three tests for the predicate.

2. **Task 5 was written test-and-implementation together**, not test-first.
   Verified after the fact by mutation: disabling the `AiTruncatedError` branch
   fails exactly one test, and restoring it passes. The test has teeth.

Two plan steps could not run as written. `npm run verify:pnl` (Task 1, Step 5)
exits before touching the database when no P&L baseline exists, so it proves
nothing about the Proxy binding; a real `select().from().limit()` and a
`count(*)` against three tables were run instead, and later `npm run
seed:setups` exercised `insert().onConflictDoUpdate()`. The fresh-clone
rehearsal (Task 16, Step 5) could not use the dev server, which keeps
`DATABASE_URL` in `process.env` from boot even after the file is removed; a
production server was started on another port with no `.env` instead, which
boots genuinely unconfigured.
