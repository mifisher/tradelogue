import { describe, it, expect } from 'vitest';
import { parseJournalEntry } from './journal-parser';

// ---------------------------------------------------------------------------
// Fixture 1: Standard shape
// Has ×2 multiplier, grades with prose, session recap, images, coaching review
// ---------------------------------------------------------------------------
const FIXTURE_STANDARD = `# Trading Journal — Monday, June 8, 2026

## Session Overview

**Sentiment (Perplexity Finance):** Bearish
**Mood:** Short night, woke before the alarm.
**Sleep:** 70/100; 6h 00m
**Market Context:** Dual headwinds into the open. ES futures -0.31%.
**P/L:** -$1,250.00

---

## Session Recap

Brutal day. Couldn't get anything to go.

![[Media/Pasted image 20260608071437.png]]

![[Media/Pasted image 20260608071450.png]]

---

## Trades

### Winning Trades

*None.*

---

### Losing Trades

**NVDA PUT (×2) — -$474**

- **Setup:** 1 — Supply Zone Fade
- **Thesis:** Break and retest below demand zone.
- **Execution:** Two attempts. Both stopped out.
- **Grade:** D — correct thesis, wrong timing.

---

**INTC CALL — -$362**

![[Media/Pasted image 20260608072811.png]]

- **Setup:** 4 — Failed Breakout Re-Entry
- **Thesis:** INTC demand hold.
- **Execution:** Stopped out at max loss.
- **Grade:** C — defensible thesis.

---

**QQQ PUT — -$364**

- **Setup:** 1 — Supply Zone Fade
- **Thesis:** QQQ failing below previous demand.
- **Execution:** Rule 3 front run.
- **Grade:** F — self-identified bad trade.

---

## P&L Summary

| Trade | Setup | Side | Result |
|-------|-------|------|--------|
| NVDA PUT (×2) | 1 | Loss | -$474.00 |
| INTC CALL | 4 | Loss | -$362.00 |
| QQQ PUT | 1 | Loss | -$364.00 |

**Session Total: -$1,250.00**

---

## Coaching Review

### What worked

- Correct directional thesis on multiple names.

### What to improve

- Rule 15 was made for this session — and wasn't applied.
`;

// ---------------------------------------------------------------------------
// Fixture 2: Early messy format
// No Session Recap, trade headers with expiry/strike/contracts, no pnl in header
// Sentiment has no "(Perplexity Finance)" suffix
// ---------------------------------------------------------------------------
const FIXTURE_EARLY_FORMAT = `# Trading Journal — Tuesday, March 24, 2026

## Session Overview

**Sentiment:** Bearish
**Mood:** Slightly better than yesterday.
**Sleep:** Score: 75/100 | Duration: 6h 30m | Slept later.
**Market Context:** Markets mixed after Monday's strong rally.
**P/L:** -$1,310.50

---

## Trades

### Losing Trades

**MU MAR 27 392.5 P — 4 contracts (avg down from 3)**
![[Media/Pasted image 20260324104809.png]]

- **Thesis:** MU dropped below overnight low.
- **Outcome:** Squeezed back above. Stopped out. ~$942+ loss.
- **Execution:** No stop loss defined.
- **Grade:** F

---

**MU MAR 27 395 C — 3 contracts**

- **Thesis:** MU appeared to reclaim overnight low.
- **Outcome:** Same fake-out pattern.
- **Execution:** Revenge trade.
- **Grade:** F (for execution)

---

### Winning Trades

**PLTR MAR 27 157.5 P — 5 contracts**

- **Thesis:** PLTR showed weakness.
- **Outcome:** Small win ~$93.
- **Execution:** Slight chase on entry.
- **Grade:** B-

---

## P&L Summary

| Trade | Side | Result |
|-------|------|--------|
| MU MAR 27 392.5 P | Loss | -$942 |
| MU MAR 27 395 C | Loss | loss |
| PLTR MAR 27 157.5 P | Win | +$93 |
| **Total** | | **-$1,310.50** |

---

## Coaching Review

### What worked
- PLTR short thesis was sound.

### What to improve
- Position sizing is the #1 problem.
`;

// ---------------------------------------------------------------------------
// Fixture 3: Alternate sleep format variants
// ---------------------------------------------------------------------------
const FIXTURE_SLEEP_VARIANTS = `# Trading Journal

## Session Overview

**Sentiment:** Bullish
**Mood:** Good energy.
**Sleep:** Score: 72/100 | Duration: 6h 15m
**Market Context:** Rally on war de-escalation.
**P/L:** +$42.15

---

## Trades

### Winning Trades

*None.*

### Losing Trades

*None.*

---

## Coaching Review

Good day.
`;

// Pipe-separated variant: "81/100 | 5h 29m"
const FIXTURE_SLEEP_PIPE = `# Trading Journal

## Session Overview

**Sentiment (Perplexity Finance):** Uncertain
**Mood:** Slightly sluggish.
**Sleep:** 80/100 | 6h 45m
**Market Context:** Competing forces.
**P/L:** +$360.25

---

## Trades

### Winning Trades

**NBIS CALL — 3 contracts**

- **Setup:** 2 — Compression Breakout
- **Thesis:** Post-earnings gap-up.
- **Execution:** Proactive scale-out.
- **Grade:** B+

---

### Losing Trades

*None.*

---

## Coaching Review

Good discipline.
`;

// ---------------------------------------------------------------------------
// Fixture 4: No-trade day
// ---------------------------------------------------------------------------
const FIXTURE_NO_TRADES = `# Trading Journal — Monday, May 11, 2026

## Session Overview

**Sentiment (Perplexity Finance):** Uncertain
**Mood:** Low energy.
**Sleep:** 76/100 | 6h 20m
**Market Context:** ES/NQ modestly red.
**P/L:** $0

---

## Session Recap

No trades today. The opening was choppy.

---

## Trades

No trades taken.

---

## P&L Summary

No trades.

---

## Coaching Review

### What worked

Read the conditions accurately.

### What to improve

Gym in the morning is protective.
`;

// ---------------------------------------------------------------------------
// Fixture 5: Grade with complex formatting (sub-bullets on multiple lines)
// ---------------------------------------------------------------------------
const FIXTURE_GRADE_SUBBULLETS = `# Trading Journal

## Session Overview

**Sentiment (Perplexity Finance):** Bullish
**Mood:** Good.
**Sleep:** 78/100 | 6h 50m
**Market Context:** ES near ATH.
**P/L:** +$185.40

---

## Trades

### Winning Trades

**NVDA CALL — two entries**

- **Setup:** 4 (Failed Breakout Re-Entry)
- **Thesis:** NVDA reclaimed PDH.
- **Execution:** Treated second attempt as fresh setup.
- **Grade:** A-
  - Stock Selection: A-
  - Sizing: A
  - Entry: A

---

### Losing Trades

**AAPL CALL — small**

- **Setup:** 4 (Failed Breakout Re-Entry)
- **Thesis:** AAPL breakout above overnight high.
- **Execution:** Stop tightened.
- **Grade:** B+

---

## Coaching Review

Multi-trade discipline cost an NVDA exit.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseJournalEntry', () => {
  describe('Session Overview fields', () => {
    it('parses sentiment with Perplexity Finance suffix', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.sentiment).toBe('Bearish');
    });

    it('parses sentiment without Perplexity Finance suffix', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      expect(result.sentiment).toBe('Bearish');
    });

    it('parses sessionDate from the fileDate param', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.sessionDate).toBe('2026-06-08');
    });

    it('parses mood', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.mood).toContain('Short night');
    });

    it('parses journalPnl from P/L field (negative with commas)', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.journalPnl).toBeCloseTo(-1250.00, 2);
    });

    it('parses journalPnl (positive with +)', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_PIPE, '2026-05-13');
      expect(result.journalPnl).toBeCloseTo(360.25, 2);
    });

    it('parses journalPnl of $0', () => {
      const result = parseJournalEntry(FIXTURE_NO_TRADES, '2026-05-11');
      expect(result.journalPnl).toBe(0);
    });

    it('parses marketContext as raw text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.marketContext).toContain('ES futures -0.31%');
    });
  });

  describe('Sleep parsing', () => {
    it('parses "70/100; 6h 00m" format → score=70, minutes=360', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.sleepScore).toBe(70);
      expect(result.sleepMinutes).toBe(360);
    });

    it('parses "80/100 | 6h 45m" pipe-separated format', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_PIPE, '2026-05-13');
      expect(result.sleepScore).toBe(80);
      expect(result.sleepMinutes).toBe(405);
    });

    it('parses "Score: 72/100 | Duration: 6h 15m" verbose format', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_VARIANTS, 'test-date');
      expect(result.sleepScore).toBe(72);
      expect(result.sleepMinutes).toBe(375);
    });

    it('parses "Score: 75/100 | Duration: 6h 30m | ..." verbose format with extra text', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      expect(result.sleepScore).toBe(75);
      expect(result.sleepMinutes).toBe(390);
    });

    it('returns null sleepScore/sleepMinutes when Sleep field absent', () => {
      const noSleep = FIXTURE_STANDARD.replace(/\*\*Sleep:\*\*.*\n/, '');
      const result = parseJournalEntry(noSleep, '2026-06-08');
      expect(result.sleepScore).toBeNull();
      expect(result.sleepMinutes).toBeNull();
    });
  });

  describe('Session Recap', () => {
    it('captures recap text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.recap).toContain('Brutal day');
    });

    it('strips image refs from recap text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.recap).not.toContain('![[');
    });

    it('puts session-level image refs (from recap) into sessionImages', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.sessionImages).toContain('Pasted image 20260608071437.png');
      expect(result.sessionImages).toContain('Pasted image 20260608071450.png');
    });

    it('returns null recap when no Session Recap section', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      expect(result.recap).toBeNull();
    });
  });

  describe('Coaching Review', () => {
    it('captures coaching review verbatim', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      expect(result.coachingReview).toContain('What worked');
      expect(result.coachingReview).toContain('Rule 15 was made for this session');
    });

    it('coaching review is non-null when section exists', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      expect(result.coachingReview).toBeTruthy();
      expect(result.coachingReview).toContain('Position sizing is the #1 problem');
    });

    it('returns null coachingReview when section absent', () => {
      const noCoaching = `# Journal\n\n## Session Overview\n\n**Sentiment:** Bullish\n**Mood:** Good.\n**P/L:** $0\n\n## Trades\n\nNo trades taken.\n`;
      const result = parseJournalEntry(noCoaching, 'test-date');
      expect(result.coachingReview).toBeNull();
    });
  });

  describe('Trade blocks', () => {
    it('parses NVDA PUT (×2) header: underlying=NVDA, putCall=P, pnl=-474', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda).toBeDefined();
      expect(nvda!.putCall).toBe('P');
      expect(nvda!.pnl).toBe(-474);
    });

    it('parses INTC CALL header: underlying=INTC, putCall=C, pnl=-362', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const intc = result.trades.find((t) => t.underlying === 'INTC');
      expect(intc).toBeDefined();
      expect(intc!.putCall).toBe('C');
      expect(intc!.pnl).toBe(-362);
    });

    it('parses QQQ PUT without $ pnl in some formats → pnl=-364', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const qqq = result.trades.find((t) => t.underlying === 'QQQ');
      expect(qqq!.pnl).toBe(-364);
    });

    it('parses setupNumber from "- **Setup:** 1 — ..."', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda!.setupNumber).toBe(1);
    });

    it('parses setupNumber from "- **Setup:** 4 (Failed...)" parenthesis style', () => {
      const result = parseJournalEntry(FIXTURE_GRADE_SUBBULLETS, 'test-date');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda!.setupNumber).toBe(4);
    });

    it('parses grade with prose suffix — extracts letter grade only', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda!.grade).toBe('D');
    });

    it('parses multi-word grade "F (for execution)" → F', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      const muCall = result.trades.find((t) => t.underlying === 'MU' && t.putCall === 'C');
      expect(muCall!.grade).toBe('F');
    });

    it('parses grade A-', () => {
      const result = parseJournalEntry(FIXTURE_GRADE_SUBBULLETS, 'test-date');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda!.grade).toBe('A-');
    });

    it('parses grade B+', () => {
      const result = parseJournalEntry(FIXTURE_GRADE_SUBBULLETS, 'test-date');
      const aapl = result.trades.find((t) => t.underlying === 'AAPL');
      expect(aapl!.grade).toBe('B+');
    });

    it('parses thesis text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda!.thesis).toContain('Break and retest below demand zone');
    });

    it('parses execution notes', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const nvda = result.trades.find((t) => t.underlying === 'NVDA');
      expect(nvda!.executionNotes).toContain('Two attempts');
    });

    it('handles early format with expiry/strike in header: MU MAR 27 392.5 P', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      const muPuts = result.trades.filter((t) => t.underlying === 'MU' && t.putCall === 'P');
      expect(muPuts).toHaveLength(1);
    });

    it('handles "CALL" header to putCall=C correctly', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      const mu = result.trades.find((t) => t.underlying === 'MU' && t.putCall === 'C');
      expect(mu!.putCall).toBe('C');
    });

    it('collects images inside trade block', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      const intc = result.trades.find((t) => t.underlying === 'INTC');
      expect(intc!.images).toContain('Pasted image 20260608072811.png');
    });

    it('returns empty trades array for no-trade day', () => {
      const result = parseJournalEntry(FIXTURE_NO_TRADES, '2026-05-11');
      expect(result.trades).toHaveLength(0);
    });

    it('does not include pnl summary rows as trades', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      // NVDA, INTC, QQQ = 3 trade blocks
      expect(result.trades).toHaveLength(3);
    });
  });

  describe('Session images (all image refs in entry)', () => {
    it('collects session-level images from session overview area too', () => {
      // The early format has an image inside the Session Overview
      const entryWithOverviewImage = `# Journal\n\n## Session Overview\n\n**Sentiment:** Bullish\n**Mood:** Good.\n**Sleep:** 80/100 | 5h 0m\n**Market Context:** OK\n![[Media/overview.png]]\n**P/L:** $0\n\n## Trades\n\nNo trades.\n\n## Coaching Review\n\nGood.`;
      const result = parseJournalEntry(entryWithOverviewImage, 'test-date');
      expect(result.sessionImages).toContain('overview.png');
    });
  });

  describe('Edge cases', () => {
    it('handles $0 P/L (no sign, no cents)', () => {
      const result = parseJournalEntry(FIXTURE_NO_TRADES, '2026-05-11');
      expect(result.journalPnl).toBe(0);
    });

    it('handles "7hr" sleep duration format → 420 minutes', () => {
      const entry = `# Journal\n\n## Session Overview\n\n**Sentiment:** Bearish\n**Mood:** OK.\n**Sleep:** 74/100; 7hr\n**Market Context:** Sideways.\n**P/L:** -$100\n\n## Trades\n\nNo trades.\n\n## Coaching Review\n\nOK.`;
      const result = parseJournalEntry(entry, 'test-date');
      expect(result.sleepScore).toBe(74);
      expect(result.sleepMinutes).toBe(420);
    });

    it('handles trade header with no pnl amount → pnl=null', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-03-24');
      const pltr = result.trades.find((t) => t.underlying === 'PLTR');
      expect(pltr!.pnl).toBeNull();
    });

    it('parses Bullish sentiment', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_VARIANTS, 'test-date');
      expect(result.sentiment).toBe('Bullish');
    });

    it('returns sessionImages with all image refs across the entry', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-06-08');
      // Session recap has 2, INTC trade block has 1 (but session images = all in entry)
      expect(result.sessionImages.length).toBeGreaterThanOrEqual(2);
    });
  });
});
