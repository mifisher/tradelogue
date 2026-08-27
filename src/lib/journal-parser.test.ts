import { describe, it, expect } from 'vitest';
import { parseJournalEntry } from './journal-parser';

// ---------------------------------------------------------------------------
// Fixture 1: Standard shape
// Has ×2 multiplier, grades with prose, session recap, images, coaching review
// ---------------------------------------------------------------------------
const FIXTURE_STANDARD = `# Trading Journal — Monday, January 5, 2026

## Session Overview

**Sentiment (Perplexity Finance):** Bearish
**Mood:** Short night, sample entry.
**Sleep:** 68/100; 6h 00m
**Market Context:** Sample context. ES futures -0.25%.
**P/L:** -$1,200.00

---

## Session Recap

Sample recap. Nothing worked.

![[Media/Pasted image 20260105071437.png]]

![[Media/Pasted image 20260105071450.png]]

---

## Trades

### Winning Trades

*None.*

---

### Losing Trades

**ACME PUT (×2) — -$488**

- **Setup:** 1 — Example Fade
- **Thesis:** Sample thesis: break and retest.
- **Execution:** Two attempts. Sample notes.
- **Grade:** D — sample grade note.

---

**GLBX CALL — -$312**

![[Media/Pasted image 20260105072811.png]]

- **Setup:** 4 — Example Re-Entry
- **Thesis:** GLBX sample thesis.
- **Execution:** Sample execution note.
- **Grade:** C — sample grade note.

---

**INIT PUT — -$400**

- **Setup:** 1 — Example Fade
- **Thesis:** INIT sample thesis.
- **Execution:** Sample rule break.
- **Grade:** F — sample grade note.

---

## P&L Summary

| Trade | Setup | Side | Result |
|-------|-------|------|--------|
| ACME PUT (×2) | 1 | Loss | -$488.00 |
| GLBX CALL | 4 | Loss | -$312.00 |
| INIT PUT | 1 | Loss | -$400.00 |

**Session Total: -$1,200.00**

---

## Coaching Review

### What worked

- Sample positive note.

### What to improve

- Sample rule note — and wasn't applied.
`;

// ---------------------------------------------------------------------------
// Fixture 2: Early messy format
// No Session Recap, trade headers with expiry/strike/contracts, no pnl in header
// Sentiment has no "(Perplexity Finance)" suffix
// ---------------------------------------------------------------------------
const FIXTURE_EARLY_FORMAT = `# Trading Journal — Tuesday, February 3, 2026

## Session Overview

**Sentiment:** Bearish
**Mood:** Sample mood.
**Sleep:** Score: 75/100 | Duration: 6h 30m | Sample note.
**Market Context:** Sample context.
**P/L:** -$1,100.50

---

## Trades

### Losing Trades

**ACME FEB 6 50 P — 4 contracts (avg down from 3)**
![[Media/Pasted image 20260203104809.png]]

- **Thesis:** Sample thesis.
- **Outcome:** Sample outcome. ~$900+ loss.
- **Execution:** Sample execution note.
- **Grade:** F

---

**ACME FEB 6 52 C — 3 contracts**

- **Thesis:** Sample thesis.
- **Outcome:** Sample outcome.
- **Execution:** Sample execution note.
- **Grade:** F (for execution)

---

### Winning Trades

**GLBX FEB 6 20 P — 5 contracts**

- **Thesis:** Sample thesis.
- **Outcome:** Small win ~$80.
- **Execution:** Sample execution note.
- **Grade:** B-

---

## P&L Summary

| Trade | Side | Result |
|-------|------|--------|
| ACME FEB 6 50 P | Loss | -$900 |
| ACME FEB 6 52 C | Loss | loss |
| GLBX FEB 6 20 P | Win | +$80 |
| **Total** | | **-$1,100.50** |

---

## Coaching Review

### What worked
- Sample positive note.

### What to improve
- Sample improvement note.
`;

// ---------------------------------------------------------------------------
// Fixture 3: Alternate sleep format variants
// ---------------------------------------------------------------------------
const FIXTURE_SLEEP_VARIANTS = `# Trading Journal

## Session Overview

**Sentiment:** Bullish
**Mood:** Sample mood.
**Sleep:** Score: 72/100 | Duration: 6h 15m
**Market Context:** Sample context.
**P/L:** +$50.15

---

## Trades

### Winning Trades

*None.*

### Losing Trades

*None.*

---

## Coaching Review

Sample review.
`;

// Pipe-separated variant: "81/100 | 5h 29m"
const FIXTURE_SLEEP_PIPE = `# Trading Journal

## Session Overview

**Sentiment (Perplexity Finance):** Uncertain
**Mood:** Sample mood.
**Sleep:** 80/100 | 6h 45m
**Market Context:** Sample context.
**P/L:** +$300.25

---

## Trades

### Winning Trades

**INIT CALL — 3 contracts**

- **Setup:** 2 — Example Breakout
- **Thesis:** Sample thesis.
- **Execution:** Sample execution note.
- **Grade:** B+

---

### Losing Trades

*None.*

---

## Coaching Review

Sample review.
`;

// ---------------------------------------------------------------------------
// Fixture 4: No-trade day
// ---------------------------------------------------------------------------
const FIXTURE_NO_TRADES = `# Trading Journal — Monday, March 9, 2026

## Session Overview

**Sentiment (Perplexity Finance):** Uncertain
**Mood:** Sample mood.
**Sleep:** 76/100 | 6h 20m
**Market Context:** Sample context.
**P/L:** $0

---

## Session Recap

No trades today. Sample recap.

---

## Trades

No trades taken.

---

## P&L Summary

No trades.

---

## Coaching Review

### What worked

Sample positive note.

### What to improve

Sample improvement note.
`;

// ---------------------------------------------------------------------------
// Fixture 5: Grade with complex formatting (sub-bullets on multiple lines)
// ---------------------------------------------------------------------------
const FIXTURE_GRADE_SUBBULLETS = `# Trading Journal

## Session Overview

**Sentiment (Perplexity Finance):** Bullish
**Mood:** Good.
**Sleep:** 78/100 | 6h 50m
**Market Context:** Sample context.
**P/L:** +$150.40

---

## Trades

### Winning Trades

**ACME CALL — two entries**

- **Setup:** 4 (Example Re-Entry)
- **Thesis:** Sample thesis.
- **Execution:** Sample execution note.
- **Grade:** A-
  - Stock Selection: A-
  - Sizing: A
  - Entry: A

---

### Losing Trades

**GLBX CALL — small**

- **Setup:** 4 (Example Re-Entry)
- **Thesis:** Sample thesis.
- **Execution:** Sample execution note.
- **Grade:** B+

---

## Coaching Review

Sample review.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseJournalEntry', () => {
  describe('Session Overview fields', () => {
    it('parses sentiment with Perplexity Finance suffix', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.sentiment).toBe('Bearish');
    });

    it('parses sentiment without Perplexity Finance suffix', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      expect(result.sentiment).toBe('Bearish');
    });

    it('parses sessionDate from the fileDate param', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.sessionDate).toBe('2026-01-05');
    });

    it('parses mood', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.mood).toContain('Short night');
    });

    it('parses journalPnl from P/L field (negative with commas)', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.journalPnl).toBeCloseTo(-1200.00, 2);
    });

    it('parses journalPnl (positive with +)', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_PIPE, '2026-03-10');
      expect(result.journalPnl).toBeCloseTo(300.25, 2);
    });

    it('parses journalPnl of $0', () => {
      const result = parseJournalEntry(FIXTURE_NO_TRADES, '2026-03-09');
      expect(result.journalPnl).toBe(0);
    });

    it('parses marketContext as raw text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.marketContext).toContain('ES futures -0.25%');
    });
  });

  describe('Sleep parsing', () => {
    it('parses "68/100; 6h 00m" format → score=70, minutes=360', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.sleepScore).toBe(68);
      expect(result.sleepMinutes).toBe(360);
    });

    it('parses "80/100 | 6h 45m" pipe-separated format', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_PIPE, '2026-03-10');
      expect(result.sleepScore).toBe(80);
      expect(result.sleepMinutes).toBe(405);
    });

    it('parses "Score: 72/100 | Duration: 6h 15m" verbose format', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_VARIANTS, 'test-date');
      expect(result.sleepScore).toBe(72);
      expect(result.sleepMinutes).toBe(375);
    });

    it('parses "Score: 75/100 | Duration: 6h 30m | ..." verbose format with extra text', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      expect(result.sleepScore).toBe(75);
      expect(result.sleepMinutes).toBe(390);
    });

    it('returns null sleepScore/sleepMinutes when Sleep field absent', () => {
      const noSleep = FIXTURE_STANDARD.replace(/\*\*Sleep:\*\*.*\n/, '');
      const result = parseJournalEntry(noSleep, '2026-01-05');
      expect(result.sleepScore).toBeNull();
      expect(result.sleepMinutes).toBeNull();
    });
  });

  describe('Session Recap', () => {
    it('captures recap text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.recap).toContain('Sample recap');
    });

    it('strips image refs from recap text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.recap).not.toContain('![[');
    });

    it('puts session-level image refs (from recap) into sessionImages', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.sessionImages).toContain('Pasted image 20260105071437.png');
      expect(result.sessionImages).toContain('Pasted image 20260105071450.png');
    });

    it('returns null recap when no Session Recap section', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      expect(result.recap).toBeNull();
    });
  });

  describe('Coaching Review', () => {
    it('captures coaching review verbatim', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      expect(result.coachingReview).toContain('What worked');
      expect(result.coachingReview).toContain('Sample rule note');
    });

    it('coaching review is non-null when section exists', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      expect(result.coachingReview).toBeTruthy();
      expect(result.coachingReview).toContain('Sample improvement note');
    });

    it('returns null coachingReview when section absent', () => {
      const noCoaching = `# Journal\n\n## Session Overview\n\n**Sentiment:** Bullish\n**Mood:** Good.\n**P/L:** $0\n\n## Trades\n\nNo trades taken.\n`;
      const result = parseJournalEntry(noCoaching, 'test-date');
      expect(result.coachingReview).toBeNull();
    });
  });

  describe('Trade blocks', () => {
    it('parses ACME PUT (×2) header: underlying=ACME, putCall=P, pnl=-488', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1).toBeDefined();
      expect(acme1!.putCall).toBe('P');
      expect(acme1!.pnl).toBe(-488);
    });

    it('parses GLBX CALL header: underlying=GLBX, putCall=C, pnl=-312', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const glbx1 = result.trades.find((t) => t.underlying === 'GLBX');
      expect(glbx1).toBeDefined();
      expect(glbx1!.putCall).toBe('C');
      expect(glbx1!.pnl).toBe(-312);
    });

    it('parses INIT PUT header → pnl=-400', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const init = result.trades.find((t) => t.underlying === 'INIT');
      expect(init!.pnl).toBe(-400);
    });

    it('parses setupNumber from "- **Setup:** 1 — ..."', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1!.setupNumber).toBe(1);
    });

    it('parses setupNumber from "- **Setup:** 4 (Example...)" parenthesis style', () => {
      const result = parseJournalEntry(FIXTURE_GRADE_SUBBULLETS, 'test-date');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1!.setupNumber).toBe(4);
    });

    it('parses grade with prose suffix — extracts letter grade only', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1!.grade).toBe('D');
    });

    it('parses multi-word grade "F (for execution)" → F', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      const acmeCall = result.trades.find((t) => t.underlying === 'ACME' && t.putCall === 'C');
      expect(acmeCall!.grade).toBe('F');
    });

    it('parses grade A-', () => {
      const result = parseJournalEntry(FIXTURE_GRADE_SUBBULLETS, 'test-date');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1!.grade).toBe('A-');
    });

    it('parses grade B+', () => {
      const result = parseJournalEntry(FIXTURE_GRADE_SUBBULLETS, 'test-date');
      const glbx2 = result.trades.find((t) => t.underlying === 'GLBX');
      expect(glbx2!.grade).toBe('B+');
    });

    it('parses thesis text', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1!.thesis).toContain('Sample thesis: break and retest');
    });

    it('parses execution notes', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const acme1 = result.trades.find((t) => t.underlying === 'ACME');
      expect(acme1!.executionNotes).toContain('Two attempts');
    });

    it('handles early format with expiry/strike in header: ACME FEB 6 50 P', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      const acmePuts = result.trades.filter((t) => t.underlying === 'ACME' && t.putCall === 'P');
      expect(acmePuts).toHaveLength(1);
    });

    it('handles "CALL" header to putCall=C correctly', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      const acme = result.trades.find((t) => t.underlying === 'ACME' && t.putCall === 'C');
      expect(acme!.putCall).toBe('C');
    });

    it('collects images inside trade block', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      const glbx1 = result.trades.find((t) => t.underlying === 'GLBX');
      expect(glbx1!.images).toContain('Pasted image 20260105072811.png');
    });

    it('returns empty trades array for no-trade day', () => {
      const result = parseJournalEntry(FIXTURE_NO_TRADES, '2026-03-09');
      expect(result.trades).toHaveLength(0);
    });

    it('does not include pnl summary rows as trades', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      // ACME, GLBX, INIT = 3 trade blocks
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
      const result = parseJournalEntry(FIXTURE_NO_TRADES, '2026-03-09');
      expect(result.journalPnl).toBe(0);
    });

    it('handles "7hr" sleep duration format → 420 minutes', () => {
      const entry = `# Journal\n\n## Session Overview\n\n**Sentiment:** Bearish\n**Mood:** OK.\n**Sleep:** 74/100; 7hr\n**Market Context:** Sideways.\n**P/L:** -$100\n\n## Trades\n\nNo trades.\n\n## Coaching Review\n\nOK.`;
      const result = parseJournalEntry(entry, 'test-date');
      expect(result.sleepScore).toBe(74);
      expect(result.sleepMinutes).toBe(420);
    });

    it('handles trade header with no pnl amount → pnl=null', () => {
      const result = parseJournalEntry(FIXTURE_EARLY_FORMAT, '2026-02-03');
      const glbx = result.trades.find((t) => t.underlying === 'GLBX');
      expect(glbx!.pnl).toBeNull();
    });

    it('parses Bullish sentiment', () => {
      const result = parseJournalEntry(FIXTURE_SLEEP_VARIANTS, 'test-date');
      expect(result.sentiment).toBe('Bullish');
    });

    it('returns sessionImages with all image refs across the entry', () => {
      const result = parseJournalEntry(FIXTURE_STANDARD, '2026-01-05');
      // Session recap has 2, GLBX trade block has 1 (but session images = all in entry)
      expect(result.sessionImages.length).toBeGreaterThanOrEqual(2);
    });
  });
});
