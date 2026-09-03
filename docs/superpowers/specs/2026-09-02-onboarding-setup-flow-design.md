# First-run setup wizard and settings page

**Date:** 2026-09-02
**Status:** Approved for planning

## Problem

A fresh clone of the public repo cannot reach a working state without reading
20KB of README and hand-editing `.env`. Worse, it cannot even *render*: with no
`DATABASE_URL`, `src/db/index.ts` throws while the module is being imported, and
because the root layout imports it transitively, every route 500s. The first
thing a new user sees is a stack trace.

Three things stand between a clone and a working journal, and none of them has a
UI: a database, an AI key, and IBKR Flex credentials. Each has non-obvious
acquisition steps — especially the Flex Query, whose field list and date-format
settings the parser depends on exactly.

## Goals

- A new clone renders a setup wizard instead of crashing.
- Timezone, AI provider/keys/models, IBKR Flex credentials, and market-data keys
  are all enterable through the UI, each with inline instructions on where to
  obtain them and a button that verifies the value actually works.
- The same forms remain available afterwards as a permanent `/settings` page for
  rotating keys and swapping models.
- `npm run import:flex`, `npm run sync:daily`, `npm run eval:coaching`, and the
  launchd plists keep working with no changes.

## Non-goals

- Installing Node or Postgres. Those stay terminal steps.
- Multi-user, auth, or remote deployment. This is a localhost, single-user,
  local-first app and the design assumes it.
- Replacing the README. The README stays the standalone reference for people
  reading the repo on GitHub; the wizard carries a condensed version of the same
  instructions.

## Key decision: `.env` remains the single source of truth

The wizard writes into `.env`. Considered and rejected:

- **Settings table in Postgres.** No restart needed, but `DATABASE_URL` cannot
  live there (chicken-and-egg) and `NEXT_PUBLIC_TRADING_TIMEZONE` is inlined at
  build time, so configuration would split across two homes with different
  precedence rules. Every CLI script and cron job would need teaching to read
  from the database. Large diff, split truth.
- **Hybrid** (keys in DB, `DATABASE_URL` + timezone in `.env`). Same split-truth
  problem, plus API keys stored as plaintext Postgres rows.

Writing `.env` keeps one home for configuration, the one the README, the scripts,
and the plists already read.

### Consequence: saving requires a process restart

`process.env` is populated once at boot. The Next dev server watches `.env` and
restarts itself on change, so in the documented `npm run dev` workflow this is
automatic and takes about two seconds. Under `next start` it requires a manual
restart, and `NEXT_PUBLIC_TRADING_TIMEZONE` requires a rebuild because it is
inlined at build time.

The UI handles this rather than hiding it: after a save, the client polls
`GET /api/setup/status` until the server answers with the new value, showing
"applying…" meanwhile. If polling exceeds ~15s the step says so and tells the
user to restart the server manually — the production case.

## Architecture

### 1. Lazy database handle (prerequisite)

`src/db/index.ts` currently throws during module evaluation. Guarding individual
pages would not help — the failure happens at import. The fix is at the single
point all callers route through: construct the pool on first property access.

```ts
let real: NodePgDatabase | null = null;

function connect(): NodePgDatabase {
  if (!process.env.DATABASE_URL) throw new DatabaseNotConfiguredError(CURRENT_MESSAGE);
  real ??= drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
  return real;
}

export const db = new Proxy({} as NodePgDatabase, {
  get(_t, prop) {
    const target = connect();
    const value = Reflect.get(target, prop);
    // Drizzle's builder methods are `this`-dependent; an unbound reference breaks them.
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
```

The existing error message is preserved but now thrown at query time, where it
is catchable. A named `DatabaseNotConfiguredError` lets the layout and error
boundary distinguish "not set up yet" from "query failed".

### 2. `src/lib/setup/env-file.ts`

Read and upsert `.env`, preserving comments and ordering.

- `readEnvFile(path)` → `Record<string, string>`
- `upsertEnvFile(path, updates)` — replaces an existing `KEY=` line in place;
  uncomments and replaces a `# KEY=` line if that is all that exists; otherwise
  appends. Written with mode `0600`.
- Values needing it are quoted; a `#` inside a value must not truncate it.
- If `.env` is absent, seeds from `.env.example` so the user inherits its
  comments rather than getting a bare key dump.

This is the one piece of real parsing logic in the feature and carries the
bulk of the tests.

### 3. `src/lib/setup/state.ts`

`setupState(env = process.env)` returns which of the five areas are configured
(database, timezone, ai, ibkr, market) plus an overall `needsSetup` flag.

Deliberately reads only `process.env` — it runs in the root layout on every
request and must not touch the database, which may not exist.

### 4. `src/lib/setup/actions.ts` — server actions

- `saveSetup(section, values)` — validates with zod, calls `upsertEnvFile`.
- `testDatabase(url)` — `SELECT 1` on a throwaway `Pool`, closed afterwards.
  Also reports whether the schema exists (probes for the `executions` table), so
  step 1 can tell "wrong URL" from "right URL, not migrated yet".
- `testAi(provider, key, model)` — one minimal request through the existing
  `generateStructuredObject`, so it exercises key, model name, and base URL
  together rather than just authentication.
- `testIbkr(token, queryId)` — `fetchFlexStatement` with `maxAttempts: 2`. Its
  `FlexError` messages are already written for a trader to read, so they surface
  verbatim.
- `testTavily(key)` / `testFinnhub(key)` — one cheap real call each.
- `runMigrations()` — spawns the existing `db:push` and `seed:setups` npm
  scripts and streams output back. See "Risks".

Secrets are never returned to the client. Existing values render masked
(`sk-or-…4f2a`); an untouched masked field is omitted from the save payload.

### 5. Routes

`/setup` — the wizard. Six steps, each independently completable and skippable,
each showing a status dot. Steps are the section components listed below.

`/settings` — the same section components rendered flat, without wizard chrome
or step ordering.

`GET /api/setup/status` — returns `setupState()`, used by the post-save poll.
A route handler rather than a server action because the client needs to call it
repeatedly across a server restart.

### 6. Gate in the root layout

`src/app/layout.tsx` calls `setupState()`. When `DATABASE_URL` is absent, it
renders `<SetupWizard />` in place of `children` — for *every* route, including
`/setup` itself, whose page is that same component. So an unconfigured install
shows the wizard whatever URL is requested, and there is no redirect to loop and
no pathname to thread into a layout. The requested URL stays in the address bar;
that is accepted, as the alternative costs more than it is worth here.

Explicitly not using a redirect: in Next 16 the `middleware` convention is
deprecated and renamed to `proxy.ts`, and its own documentation cautions that
proxy code is meant to run separately from render code and should not rely on
shared modules. Reaching for a new root-level file convention and a second
runtime, to change which URL is displayed while showing the same component, is
not a trade worth making.

Once `DATABASE_URL` is present the app renders normally, with a "Finish setup"
pill in the nav when AI or IBKR is still unconfigured.

`getBriefFreshness()` is wrapped in try/catch; `Nav` already accepts a null
status, so an unmigrated database degrades to a header without a session stamp
rather than a crash.

`src/app/error.tsx` — a small boundary that recognises
`DatabaseNotConfiguredError` and points at `/setup` instead of showing a Next
stack trace. This covers the "URL set but schema not pushed" state.

## Wizard steps

| # | Step | Fields | Verify |
|---|------|--------|--------|
| 1 | Database | `DATABASE_URL`, prefilled with the native (5432) and Docker (5433) defaults as one-click options | `SELECT 1` + schema probe, then "Create schema & seed" |
| 2 | Your trading day | Timezone select from `Intl.supportedValuesOf('timeZone')`, defaulting to the browser's zone; the five `RULE_*` thresholds in a collapsed section | — |
| 3 | AI | Provider radio (OpenRouter / Moonshot / Anthropic), API key, five model slots prefilled with the README's recommended configuration | One minimal live call |
| 4 | Interactive Brokers | `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`, `IBKR_TRADE_CONFIRM_QUERY_ID`, with the exact Flex Query section, field list, and the three format settings the parser requires shown inline | Live Flex fetch |
| 5 | Market data (optional) | `TAVILY_API_KEY`, `FINNHUB_API_KEY` | One cheap call each |
| 6 | Finish | "Import my trades now" → then on to `/rules` | — |

Every key field carries a one-line "where to get this" with a direct link:
OpenRouter keys page, Anthropic console, Kimi Open Platform, IBKR Client Portal
→ Performance & Reports → Flex Queries, Tavily, Finnhub.

Step 4's instructions are the highest-value copy in the feature: the parser
depends on `yyyyMMdd`, `HHmmss`, and a `;` separator exactly, and a wrong setting
there produces a parse failure whose cause is not visible from the error.

Step 6 closes on `/rules` deliberately. A fresh install seeds one sample rule,
and the README is explicit that a borrowed rulebook is worse than none — the
wizard should hand the user off to writing their own rather than implying the
shipped rule is a default worth keeping.

## Data flow

```
Wizard form (client)
  → server action (validate with zod)
    → upsertEnvFile writes .env (0600)
      → Next dev server detects the change, restarts
        → client polls /api/setup/status until the new value appears
          → step marked complete
```

Test buttons bypass the file entirely: they take the value from the form and
call the live service, so a key is proven before it is written.

## Error handling

- Test failures render the underlying error text. `FlexError` and the provider's
  `invalidApiKeyMessage` are already written for a human and pass through
  unchanged rather than being wrapped.
- `upsertEnvFile` failing (permissions, read-only checkout) reports the path and
  falls back to showing the exact lines to paste into `.env` by hand.
- The restart poll timing out reports the manual-restart instruction rather than
  spinning forever.
- `runMigrations` streams stdout/stderr; a non-zero exit shows the output and the
  equivalent terminal command.

## Testing

Real unit tests, no mocked filesystem where a tmpdir will do:

- `env-file.test.ts` — replacing an existing key; uncommenting and replacing a
  `# KEY=` line; appending an absent key; a value containing `#`; a value
  needing quotes; seeding from `.env.example` when `.env` is absent; file mode.
- `state.test.ts` — each area's configured/unconfigured detection and the
  `needsSetup` rollup, including AI provider inference matching
  `normalizeProvider`.
- `db` lazy proxy — a query throws `DatabaseNotConfiguredError` (catchable) when
  `DATABASE_URL` is unset, rather than throwing at import.

The test actions are thin wrappers over `flex-client`, `provider`, `tavily`, and
`finnhub`, all of which already have coverage; they get no new tests beyond
argument plumbing.

## Risks

**Migrations spawned from a web page.** Step 1's "Create schema & seed" runs
`drizzle-kit push` via `child_process`. Justified by the app being localhost-only
and single-user, and it reuses the existing npm scripts rather than
reimplementing them. If this is unwanted, the step degrades to displaying the
command to copy, and nothing else in the design changes.

**Instruction drift.** The wizard's setup copy duplicates the README's. Sharing
prose between Markdown and JSX would cost more than it saves, so the duplication
is accepted; the README stays authoritative and the wizard stays condensed.

**Secrets in a browser form.** Values are posted to a server action over
localhost, written to a `0600` file, and never sent back to the client
unmasked. Nothing leaves the machine.

## Files

New:
- `src/lib/setup/env-file.ts` + test
- `src/lib/setup/state.ts` + test
- `src/lib/setup/actions.ts`
- `src/app/setup/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/api/setup/status/route.ts`
- `src/app/error.tsx`
- `src/components/setup/` — one component per section, shared by both routes

Changed:
- `src/db/index.ts` — lazy proxy
- `src/app/layout.tsx` — setup gate, tolerate an unreachable database
- `src/components/nav.tsx` — Settings link, "Finish setup" pill
- `README.md` — replace hand-editing `.env` with "start the app; the wizard
  takes it from here", keeping the reference sections intact
