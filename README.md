# Tradelogue

A local-first, AI-native trading journal for options day traders.

Tradelogue pulls your fills straight from Interactive Brokers, rebuilds them
into round-trip trades, and gives you a journal that can actually read your
history: per-session coaching, pattern analysis across every trade you have
logged, a chat interface over your own data, and a premarket brief. It runs
entirely on your machine, against your own Postgres, using **your** API keys
and **your** choice of model.

Nothing leaves your machine except the calls you configure — to IBKR for your
trades, and to whichever model provider you point it at.

> **This is a journal, not an advisor.** It has no opinion on what you should
> trade. The rules and setups it ships with are placeholder examples to show
> the shape of the thing — replace them with your own. Nothing here is
> financial advice.

---

## Table of contents

- [What's in it](#whats-in-it)
- [Getting started](#getting-started)
- [Connecting Interactive Brokers](#connecting-interactive-brokers)
- [Bring your own model](#bring-your-own-model)
- [Recommended starting configuration](#recommended-starting-configuration)
- [Choosing your models](#choosing-your-models)
- [How the models were chosen: the eval harness](#how-the-models-were-chosen-the-eval-harness)
- [Making it yours](#making-it-yours)
- [Automating the daily run](#automating-the-daily-run)
- [Development](#development)
- [License](#license)

---

## What's in it

**The data backbone.** Executions import from IBKR and are deduped on IB
execution ID. Round-trip trades are *derived* from those executions and rebuilt
from scratch on every import — `executions` is the source of truth, `trades` is
a cache. That means imports are idempotent: run them as often as you like.

**The journal.** A page per session with your notes, sentiment, screenshots,
and per-trade grades. A calendar and a trades table over the whole history.

**Mechanical rule detection** (`src/lib/rules.ts`) — no AI, just pure functions
over your fills. The engine implements seven detectors: oversized outlay,
re-entry without a pause, multiple names open at once, 0DTE contracts,
overtrading a chop day, trading through your daily loss limit, and entering in
the opening chop. Because it is deterministic, it is honest — it flags what you
actually did, not what a model guessed you did.

A fresh install seeds **one** sample rule, because a rulebook is personal.
Write your own at `/rules`, and switch on any of the other six detectors by
copying a template — see [Making it yours](#making-it-yours).

**AI coaching.** Per-session review — what worked, what to improve, patterns to
watch — grounded in that session's real numbers and your own rulebook.

**Pattern analysis.** The same coach model run across your whole journal to
surface recurring behavior rather than single-session noise.

**Chat with your journal** (`/coach`). A tool-use loop over five read-only data
tools: daily P&L, trades, sessions, violation summary, setup stats. It queries
your database to answer rather than guessing from a summary.

**Voice / "Fill with AI".** Talk through a trade after you take it; the model
fills the structured journal fields. This is the one interactive AI feature,
and it has very different model requirements from the rest — see below.

**Premarket market brief.** A dashboard strip and a `/market` page: index
levels, headlines, an economic calendar in your local time, earnings in focus,
stocks in play, and a focus list drawn from your own rules. Asset numbers, the
economic calendar, and the earnings list are always API data — the model only
annotates them, it never invents a number.

---

## Getting started

Requires **Node 20+** and **Postgres 16+**.

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/tradelogue.git && cd tradelogue && npm install
```

### 2. Start Postgres

Either native:

```bash
brew install postgresql@16 && brew services start postgresql@16
```

```bash
psql -d postgres -c "CREATE ROLE trader WITH LOGIN PASSWORD 'trader' CREATEDB;" && createdb -O trader tradelogue
```

…or Docker, which listens on **5433** so it will not fight a native install:

```bash
docker compose up -d
```

If you use Docker, change the port in `DATABASE_URL` to `5433`.

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
swapping a model later. It will be empty until you import trades — that is next.

---

## Connecting Interactive Brokers

Tradelogue reads your trades through the **IBKR Flex Web Service**, which is
read-only and separate from your trading credentials. It cannot place orders.

Currently IBKR is the only supported broker. The parser is isolated in
`src/lib/flex-parser.ts`, so adding another broker means writing a parser that
emits the same execution shape.

### Create the Flex Query

In **Client Portal → Performance & Reports → Flex Queries**, create a query.
You want two eventually, but start with the first:

1. **Activity Flex Query** — your end-of-day history, and the backbone of your
   journal.
2. **Trade Confirmation Flex Query** — same-day fills, so you can journal
   intraday instead of waiting for the statement to settle.

For either one:

- **Section:** Trades, with the **Executions** option enabled.
- **Fields:** Account ID, Asset Class, Symbol, Underlying Symbol, Description,
  Conid, Put/Call, Strike, Expiry, Multiplier, Date/Time, Quantity, Trade
  Price, Proceeds, IB Commission, Buy/Sell, Transaction Type, IB Exec ID,
  Notes/Codes.
- **Period:** Last 365 Calendar Days.
- **Date format:** `yyyyMMdd`
- **Time format:** `HHmmss`
- **Date/time separator:** `;` (semicolon)

Those three format settings are not cosmetic — the parser expects exactly that
shape. If your import fails to parse, check these first.

### Enable the web service

**Settings → FlexWeb Service → enable**, then generate a token. Put the token
and the query IDs in `.env`:

```
IBKR_FLEX_TOKEN=your_token
IBKR_FLEX_QUERY_ID=your_activity_query_id
IBKR_TRADE_CONFIRM_QUERY_ID=your_trade_confirm_query_id
```

### Import

```bash
npm run import:flex
```

Or upload the XML by hand: download the report from Client Portal and drop it
at http://localhost:3000/import.

Imports are idempotent — executions dedupe on IB Exec ID, and trades are
rebuilt from scratch every time. Re-running is always safe.

If IBKR's statement generation is slow or stuck (it often is around the
midnight-ET maintenance window), use the patient variant, which waits out the
throttle rather than failing:

```bash
npx tsx scripts/poll-import.ts
```

---

## Bring your own model

Every AI feature runs through one provider abstraction
(`src/lib/ai/provider.ts`). You pick the provider and, if you want, a different
model per feature. **Without any key, the app still works** — the AI features
show an "add your key" guard and everything else is unaffected.

Three providers are supported:

| `AI_PROVIDER` | Key | Why |
| --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | **Recommended.** One key reaches hundreds of models across every lab, including free ones. Swapping a model is a one-line `.env` change. |
| `moonshot` | `MOONSHOT_API_KEY` | Direct Kimi access. |
| `anthropic` | `ANTHROPIC_API_KEY` | Direct Claude access. Defaults to `claude-opus-4-8` for coach/chat/judge and `claude-sonnet-4-6` for voice. |

If `AI_PROVIDER` is omitted, the app picks whichever key is present —
OpenRouter, then Moonshot, then Anthropic.

There are five model slots. Each maps to a feature with genuinely different
demands:

| Slot | Feature | What it needs |
| --- | --- | --- |
| `voice` | Voice / Fill with AI | **Speed.** Non-reasoning. |
| `coach` | Session coaching + pattern analysis | Reasoning quality, long context |
| `brief` | Premarket market brief | Holding a long JSON structure |
| `chat` | Chat with your journal | Reliable function calling |
| `judge` | Eval harness only | Strong judgment, different family from `coach` |

Set `OPENROUTER_MODEL` as the fallback for all five, then override the ones
that matter with `OPENROUTER_VOICE_MODEL`, `OPENROUTER_COACH_MODEL`, and so on.
The same `_COACH_MODEL` / `_VOICE_MODEL` / `_CHAT_MODEL` / `_JUDGE_MODEL` /
`_BRIEF_MODEL` suffixes work for `MOONSHOT_` and `ANTHROPIC_` too.

Changing any of this from `/settings` writes `.env` and the dev server reloads
itself. Under `next start` there is no watcher, so restart it yourself — and a
timezone change needs a rebuild, because `NEXT_PUBLIC_TRADING_TIMEZONE` is
inlined at build time.

---

## Recommended starting configuration

This is a sane default to start from, not a permanent answer. The reasoning
behind each line is in the next section.

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...

# Fallback for any slot not overridden below.
OPENROUTER_MODEL=openrouter/free

# Interactive — must be fast, must NOT reason.
OPENROUTER_VOICE_MODEL=google/gemini-2.5-flash-lite

# Background — quality matters more than latency.
OPENROUTER_COACH_MODEL=z-ai/glm-5.3-flash
OPENROUTER_BRIEF_MODEL=z-ai/glm-5.3-flash

# Only spent when you run the eval harness. Different family from the coach.
OPENROUTER_JUDGE_MODEL=moonshotai/kimi-k2.6
```

Running cost at this configuration is a few cents a month for personal use —
the coach is roughly $0.004 a session, the brief about $0.001 a day. The judge
is the expensive one and only runs when you explicitly invoke it.

**Model names go stale.** The free tier in particular turns over constantly —
models get delisted, rate limits appear, new ones land. Treat the names above
as a starting point and expect to re-bench occasionally. That is exactly what
the eval harness is for.

---

## Choosing your models

The single most useful thing to understand: **the features split cleanly into
interactive and background, and they want opposite things.**

### Voice: fast, and explicitly not a reasoning model

You are watching this one fill in the fields after you talk. Latency *is* the
feature. A reasoning model here is actively wrong — it spends its token budget
thinking about ten short fields, and when the budget runs out mid-thought you
get truncated JSON rather than a slow-but-correct answer.

Two things worth knowing, both learned the hard way:

- **Do not set a reasoning-effort hint on a model whose reasoning is off by
  default.** Sending the hint *enables* thinking. On Gemini Flash Lite that is
  the difference between ~1.4s with zero reasoning tokens and ~10s with a few
  thousand. The hint only helps models whose reasoning is mandatory.
- **Test on an ambiguous transcript, not a clean one.** Fast models diverge
  sharply here. One candidate matched the right setup 5/5 on clear transcripts
  but answered `null`, `3`, and `1` across three runs of the same ambiguous
  one — fast and confidently wrong. Speed and consistency are not the same
  axis; check both.

### Coaching and pattern analysis: quality, and patience

Nobody is watching a session review generate. A minute or two is fine, so
spend it on capability. This slot also takes the longest context — pattern
analysis over a full journal can run to tens of thousands of prompt tokens, so
**input pricing dominates the bill here**, not output pricing. A model with
cheap input and mid-tier quality often beats a pricier, marginally smarter one.

If you want to use a reasoning model anywhere, this is the slot for it.

### Market brief: structure-holding

The brief is one long structured JSON document assembled from several API
sources. Most small and free models mangle it — they lose the schema partway
through or truncate. This is a poor slot for `openrouter/free`, because the
router picks a different model per call and you get inconsistent results for no
reason you can debug. **Pin this one.**

### Chat: function calling

`/coach` runs a tool-use loop over five read-only database tools. It needs a
model with dependable function calling; raw prose quality matters less than
whether it reliably decides to call `get_daily_pnl` instead of guessing.

### Judge: a different family from the coach

The eval harness grades coaching output. If the judge and the coach are the
same model, it grades its own work and scores it generously. Pick a different
lab's model, deliberately.

### A short checklist for swapping any model

1. Change one slot at a time.
2. Test on real data of yours, not a toy prompt.
3. For interactive slots, measure wall-clock latency, not token count.
4. For structured slots, confirm the JSON validates on several runs, not one.
5. For the coach, run the eval harness and compare scores.

---

## How the models were chosen: the eval harness

Rather than guessing which model coaches well, Tradelogue ships a harness that
measures it.

```bash
npm run eval:coaching [n]
```

It generates AI reviews for `n` journaled sessions (default 10, spread evenly
across your date range), then has a **judge model** grade each one against your
own hand-written review of that session on four axes:

- **Factual accuracy** — did it get the trades, times, and dollar amounts right?
- **Issue overlap** — did it catch what you caught?
- **Rule grounding** — did it cite your actual rules, or invent plausible ones?
- **Actionability** — is the advice specific enough to change behavior?

Results are written to `eval-results/` (gitignored — they contain your trades).
Use `-- --dry-run` to verify session selection and context assembly without
spending a single API call.

Your hand-written session reviews are the ground truth, so this only works once
you have journaled a few sessions properly. That is the point: it measures
whether a model coaches *you* well, not whether it coaches well in the
abstract.

Two things this harness taught that generalize:

- **Pin the judge, and give it the rulebook.** An early version graded against
  rules it had never been shown, so every correct rule citation looked like a
  fabrication and scores were meaningless. If your judge scores suspiciously
  low on "rule grounding", check that it can actually see the rules.
- **Cheap and fast is sometimes just worse.** In one bench, the fastest
  candidate was 8× quicker and clearly weaker on factual accuracy — it made up
  numbers. Speed is only free if you measure what it costs you.

---

## Making it yours

The app ships deliberately generic. Three things are worth replacing before you
trust its output.

### Your timezone

```
NEXT_PUBLIC_TRADING_TIMEZONE=America/New_York
```

This drives every session boundary, day grouping, and rule time. Get it right
first — if it is wrong, trades land on the wrong day and everything downstream
inherits the error.

### Your rulebook

**A fresh install ships exactly one rule.** Your rulebook encodes how you
trade, what has burned you, and what your account can absorb — someone else's
would be worse than none. The one sample rule exists to show the shape and to
demonstrate a detector firing.

Write your own at **`/rules`** in the app. Rules live in the database from
first run, so the UI is the source of truth: add, edit, disable, and delete
freely. Rules you create there are *reflective* — they appear in your rulebook
and in the AI coaching prompt, but nothing fires automatically.

To add a rule the engine checks **automatically**, copy one of the six entries
from `DETECTOR_TEMPLATES` in `src/lib/rules.ts` into `DEFAULT_RULE_CONFIGS`
above it, renumber if you like, and restart. The available detectors:

| Detector | Checks |
| --- | --- |
| `oversized-outlay` | Position cost above your cap *(the shipped sample)* |
| `reentry-pause` | Re-entering a name too soon after a losing exit |
| `single-name-at-once` | A second underlying opened while one is still live |
| `zero-dte` | Contracts expiring the same session |
| `chop-trade-cap` | Too many trades on an Uncertain tape |
| `circuit-breaker` | Opening a new trade after your daily loss limit |
| `opening-range-entry` | Entries before the opening chop has settled |

Detectors bind by **detector name, not rule number**, so renumbering your rules
never silently breaks detection.

Their thresholds come from `.env`. The shipped values are round placeholders,
not recommendations:

```
RULE_OUTLAY_CAP=1000          # oversized-outlay:    max position cost, dollars
RULE_REENTRY_PAUSE_MIN=10     # reentry-pause:       minutes before re-entering
RULE_CIRCUIT_BREAKER=-500     # circuit-breaker:     stop once day P&L hits this
RULE_CHOP_TRADE_CAP=3         # chop-trade-cap:      max trades on chop
RULE_SESSION_OPEN_HOUR=10     # opening-range-entry: entries before this hour
```

### Your setups

`src/db/seed-setups.ts` ships **one** example setup, clearly labeled, to show
the expected shape and give the AI features something to reference. It is not a
strategy — replace it.

Edit that file and re-run `npm run seed:setups` (it upserts on `number`, so
re-running updates in place rather than duplicating), or add setups directly in
the UI at `/setups`. Only `number` and `name` are required.

Both your rulebook and your setups are read live from the database and travel
with each request's context, so the AI features always grade against what you
actually keep. The system prompt itself stays fully static, which is what keeps
the provider's prompt cache hitting.

### Importing an existing journal

If you already keep a markdown trading journal (one `YYYY-MM-DD.md` per
session, Obsidian-style), there is an importer:

```bash
npm run import:journal -- "/path/to/your/journal"
```

It parses session overview fields, per-trade notes and grades, and image
references, then matches each journal trade to the real fills already imported
from IBKR. The expected format is documented in `src/lib/journal-parser.ts`,
and the fixtures in `src/lib/journal-parser.test.ts` show several accepted
variations. You will likely need to adjust the parser for your own format —
that is expected, and the tests make it safe to.

---

## Automating the daily run

Two macOS launchd templates are in `scripts/`. Both need their placeholders
replaced first — launchd does not expand `~` or `$HOME`.

Premarket brief, daily:

```bash
sed -e "s|__TRADELOGUE_DIR__|$PWD|g" -e "s|__HOME__|$HOME|g" scripts/com.tradelogue.brief.plist > ~/Library/LaunchAgents/com.tradelogue.brief.plist && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tradelogue.brief.plist
```

IBKR sync, three times a day:

```bash
sed -e "s|__TRADELOGUE_DIR__|$PWD|g" -e "s|__HOME__|$HOME|g" scripts/com.tradelogue.sync.plist > ~/Library/LaunchAgents/com.tradelogue.sync.plist && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tradelogue.sync.plist
```

The scheduled hours inside each plist are **local to your Mac** and are not
derived from `NEXT_PUBLIC_TRADING_TIMEZONE` — adjust them to your session.
Logs land in `~/Library/Logs/`. On Linux, the same two npm scripts
(`brief:generate`, `sync:daily`) work fine from cron.

A failed brief run keeps the previous brief visible with a warning rather than
blanking the dashboard.

---

## Development

```bash
npm test
```

486 unit tests across the Flex parser, trade-construction engine, daily P&L,
stats, calendar, journal parser, trade matcher, rules engine, discipline
aggregation, AI context builders, and provider selection. No database or
network required — they run in about two seconds.

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

The test suite pins the rule thresholds and timezone in `vitest.config.ts` so
your personal `.env` cannot change what the tests assert. If you change a
default in `src/lib/config.ts`, change it there too.

### Verifying the P&L engine against your own numbers

```bash
npm run verify:pnl
```

This compares computed daily P&L against `data/expected-daily-pnl.json` — a
baseline you supply, mapping session date to that day's realized P&L from your
broker statements:

```json
{ "2026-06-08": -1250.00, "2026-06-09": 342.15 }
```

It is gitignored, because it is real account data. Tolerance is set with
`PNL_TOLERANCE` (default `$0.01`); exit code 0 means everything matched. This
is the highest-value check in the repo if you modify the trade-construction
engine — it catches silent arithmetic regressions that unit tests with
synthetic fixtures will not.

### Layout

```
src/app/          Next.js routes (dashboard, day, trades, calendar, coach, market, setups, rules)
src/components/   UI components
src/db/           Drizzle schema and seed data
src/lib/          Domain logic — parser, trade builder, P&L, stats, rules
src/lib/ai/       Provider abstraction, coaching, chat tools, voice, eval judge
src/lib/market/   Market brief data sources and synthesis
scripts/          CLI entry points and launchd templates
```

---

## License

MIT — see [LICENSE](LICENSE).
