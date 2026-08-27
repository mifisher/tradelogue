/**
 * journal-parser.ts — PURE (no fs/db imports)
 *
 * Parses a Markdown trading journal entry into structured data.
 * The format is an Obsidian-style wiki: one YYYY-MM-DD.md file per session.
 */

export interface ParsedTrade {
  underlying: string;
  putCall: 'P' | 'C' | null;
  /** P/L from the trade block header (e.g. "NVDA PUT — -$474"). Preferred for DB matching. */
  pnl: number | null;
  /**
   * P/L extracted from the Outcome body text as a fallback hint for matching when
   * the header has no dollar amount. Not stored in DB — internal to the migrator.
   * Examples: "Loss: -$561", "Win: +$856", "~$42"
   */
  outcomePnlHint: number | null;
  setupNumber: number | null;
  thesis: string | null;
  executionNotes: string | null;
  grade: string | null;
  images: string[];
}

export interface ParsedJournalEntry {
  sessionDate: string;
  sentiment: string | null;
  mood: string | null;
  sleepScore: number | null;
  sleepMinutes: number | null;
  marketContext: string | null;
  recap: string | null;
  journalPnl: number | null;
  coachingReview: string | null;
  trades: ParsedTrade[];
  /** All image filenames (sans "Media/" prefix) referenced anywhere in the entry */
  sessionImages: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all ![[Media/...]] image refs from a block of text → filenames only */
function extractImages(text: string): string[] {
  const re = /!\[\[Media\/([^\]]+)\]\]/g;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/** Strip all ![[...]] refs from text */
function stripImageRefs(text: string): string {
  return text.replace(/!\[\[[^\]]+\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse a dollar amount string like "-$1,250.00", "+$360.25", "$0", "$88"
 * Returns null if unparseable.
 */
function parseDollarAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '0') return 0;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return n;
}

/**
 * Parse sleep line content (everything after "**Sleep:** ").
 * Handles formats:
 *   - "59/100; 4h 33m"
 *   - "81/100 | 5h 29m"
 *   - "Score: 71/100 | Duration: 4h 51m"
 *   - "Score: 73/100 (OK) | Duration: 5h 30m | extra..."
 *   - "84/100 | 6h 14m *(full metrics unavailable...)*"
 *   - "79/100; 7hr"
 */
function parseSleep(raw: string): { score: number | null; minutes: number | null } {
  const scoreMatch = raw.match(/(?:Score:\s*)?(\d+)\/100/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;

  // Try full "Xh Ym" or "Xh Ym" form
  const durationMatch = raw.match(/(?:Duration:\s*)?(\d+)h\s*(\d+)m/);
  if (durationMatch) {
    const minutes = parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10);
    return { score, minutes };
  }

  // Try "Xhr" (whole hours only, e.g. "7hr")
  const hrOnlyMatch = raw.match(/(?:Duration:\s*)?(\d+)hr\b/);
  if (hrOnlyMatch) {
    const minutes = parseInt(hrOnlyMatch[1], 10) * 60;
    return { score, minutes };
  }

  return { score, minutes: null };
}

/**
 * Extract a PnL hint from Outcome body text.
 * Handles: "Loss: -$561", "Win: +$856", "~$42", "+$201", "-$199 net",
 *           "Small win ~$93", "Small winner", "small win", "+$41"
 * Returns null if nothing usable found.
 */
function extractOutcomePnlHint(outcomeText: string): number | null {
  if (!outcomeText) return null;

  // Look for explicit "Loss: -$XXX" or "Win: +$XXX" or "net: -$XXX" patterns first
  const explicitMatch = outcomeText.match(/(?:Loss|Win|net):\s*([+\-]?\$?[\d,]+(?:\.\d+)?)/i);
  if (explicitMatch) {
    return parseDollarAmount(explicitMatch[1]);
  }

  // Look for signed dollar amounts like "-$561", "+$93"
  const dollarMatch = outcomeText.match(/([+\-]\$[\d,]+(?:\.\d+)?)/);
  if (dollarMatch) {
    return parseDollarAmount(dollarMatch[1]);
  }

  // Look for "~$942" style (approximate, no sign — we can't reliably determine sign)
  // Don't extract these — they're too ambiguous without a sign

  return null;
}

/**
 * Parse a trade header bold line like:
 *   "NVDA PUT (×2) — -$474"
 *   "INTC CALL — -$362"
 *   "QQQ PUT — -$364"
 *   "MU MAR 27 392.5 P — 4 contracts (avg down from 3)"
 *   "PLTR MAR 27 157.5 P — 5 contracts"
 *   "AMD 235 CALL — 5 contracts (×2 entries)"
 *   "NBIS CALL — 3 contracts"
 *   "AAPL CALL — [expiry/strike unknown]"
 *   "CRWV 89 CALL — 5 contracts"
 *   "BP MAR 27 44 CALL — 5 contracts"
 * Returns null if not a trade header.
 */
function parseTradeHeader(
  line: string,
): { underlying: string; putCall: 'P' | 'C' | null; pnl: number | null } | null {
  // Must be a bold line starting with a ticker
  const boldMatch = line.match(/^\*\*([^*]+)\*\*$/);
  if (!boldMatch) return null;

  const content = boldMatch[1].trim();
  // First token must be an uppercase ticker (letters only, 1–5 chars)
  const tokens = content.split(/\s+/);
  if (!tokens.length || !/^[A-Z]{1,5}$/.test(tokens[0])) return null;

  const underlying = tokens[0];

  // Detect PUT/CALL — look for literal PUT/CALL token, or trailing P/C letter in expiry-style headers
  let putCall: 'P' | 'C' | null = null;

  // Explicit PUT/CALL keyword anywhere in the header
  if (/\bPUT\b/i.test(content)) {
    putCall = 'P';
  } else if (/\bCALL\b/i.test(content)) {
    putCall = 'C';
  } else {
    // Expiry-style: "MU MAR 27 392.5 P" — trailing P/C before the dash
    // Look for a standalone P or C token before any " — "
    const beforeDash = content.split(' — ')[0];
    const pcMatch = beforeDash.match(/\b([PC])\b(?:\s*—\s*|$)/);
    if (!pcMatch) {
      // Look for last token before the dash that is exactly P or C
      const preDashTokens = beforeDash.trim().split(/\s+/);
      const last = preDashTokens[preDashTokens.length - 1];
      if (last === 'P') putCall = 'P';
      else if (last === 'C') putCall = 'C';
    } else {
      putCall = pcMatch[1] as 'P' | 'C';
    }
  }

  // Look for a pnl amount after " — " that starts with + or - and $
  // e.g. " — -$474" or " — +$201"
  const pnlMatch = content.match(/\s+—\s+([+\-]?\$[\d,]+(?:\.\d+)?)\s*$/);
  let pnl: number | null = null;
  if (pnlMatch) {
    pnl = parseDollarAmount(pnlMatch[1]);
  }

  return { underlying, putCall, pnl };
}

/**
 * Extract the letter grade from a grade line value like:
 *   "D — correct directional thesis..."
 *   "F"
 *   "F (for execution)"
 *   "B-"
 *   "A-"
 *   "C+"
 *   "B+ — notes..."
 *   "Stock Selection: A- | ..."   (skip — this is a sub-bullet format)
 */
function parseGrade(raw: string): string | null {
  const trimmed = raw.trim();
  // Match leading grade token: letter [A-F] optionally followed by +/-
  const m = trimmed.match(/^([A-F][+-]?)\s*(?:[—(]|$)/);
  if (m) return m[1];
  // Also handle plain single letter/grade with nothing after
  const simple = trimmed.match(/^([A-F][+-]?)$/);
  if (simple) return simple[1];
  return null;
}

/**
 * Extract the setup number from a setup line value like:
 *   "1 — Opening Range Breakout"
 *   "4 — Failed Breakout Re-Entry"
 *   "2: Compression Breakout..."
 *   "4 (Failed Breakout Re-Entry)"
 *   "Other (previous day low breakdown...)"
 */
function parseSetupNumber(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseJournalEntry(markdown: string, fileDate: string): ParsedJournalEntry {
  const lines = markdown.split('\n');

  // Collect all image refs in the entire entry
  const sessionImages: string[] = extractImages(markdown);

  // ---------------------------------------------------------------------------
  // Phase 1: Extract Session Overview fields (lines before the first "---" or "## ")
  // ---------------------------------------------------------------------------
  let sentiment: string | null = null;
  let mood: string | null = null;
  let sleepScore: number | null = null;
  let sleepMinutes: number | null = null;
  let marketContext: string | null = null;
  let journalPnl: number | null = null;

  // We'll scan line-by-line for Overview, collecting multi-line field values
  let i = 0;
  // Skip to Session Overview section
  while (i < lines.length && !lines[i].startsWith('## Session Overview')) {
    i++;
  }
  i++; // skip the "## Session Overview" header itself

  // Helper: read a possibly multi-line field value until next "**" bold field, "---", or "##"
  function readFieldValue(startLine: string, startIdx: number): { value: string; nextIdx: number } {
    let value = startLine;
    let j = startIdx;
    while (j < lines.length) {
      const l = lines[j];
      if (/^---/.test(l) || /^##/.test(l) || /^\*\*[A-Z]/.test(l)) break;
      value += '\n' + l;
      j++;
    }
    return { value: value.trim(), nextIdx: j };
  }

  while (i < lines.length) {
    const line = lines[i];
    if (/^---/.test(line) || /^##/.test(line)) break;

    // **Sentiment (Perplexity Finance):** or **Sentiment:**
    const sentimentMatch = line.match(/^\*\*Sentiment(?:\s*\([^)]+\))?:\*\*\s*(.+)/);
    if (sentimentMatch) {
      sentiment = sentimentMatch[1].trim();
      i++;
      continue;
    }

    // **Mood:**
    const moodMatch = line.match(/^\*\*Mood:\*\*\s*(.*)/);
    if (moodMatch) {
      const { value, nextIdx } = readFieldValue(moodMatch[1], i + 1);
      mood = value.trim() || null;
      i = nextIdx;
      continue;
    }

    // **Sleep:**
    const sleepMatch = line.match(/^\*\*Sleep:\*\*\s*(.*)/);
    if (sleepMatch) {
      const { score, minutes } = parseSleep(sleepMatch[1]);
      sleepScore = score;
      sleepMinutes = minutes;
      i++;
      continue;
    }

    // **Market Context:**
    const marketMatch = line.match(/^\*\*Market Context:\*\*\s*(.*)/);
    if (marketMatch) {
      const { value, nextIdx } = readFieldValue(marketMatch[1], i + 1);
      // Strip any image refs that sneak into Market Context
      marketContext = stripImageRefs(value) || null;
      i = nextIdx;
      continue;
    }

    // **P/L:**
    const plMatch = line.match(/^\*\*P\/L:\*\*\s*([+\-]?\$?[\d,]+(?:\.\d+)?)/);
    if (plMatch) {
      journalPnl = parseDollarAmount(plMatch[1]);
      i++;
      continue;
    }

    i++;
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Find sections — Session Recap, Trades, Coaching Review
  // ---------------------------------------------------------------------------
  let recap: string | null = null;
  let coachingReview: string | null = null;

  // Find section boundaries by scanning for ## headers
  const sectionStarts: { name: string; lineIdx: number }[] = [];
  for (let li = 0; li < lines.length; li++) {
    const m = lines[li].match(/^##\s+(.+)/);
    if (m) sectionStarts.push({ name: m[1].trim(), lineIdx: li });
  }

  function getSectionLines(sectionName: string): string[] {
    const idx = sectionStarts.findIndex(
      (s) => s.name.toLowerCase() === sectionName.toLowerCase(),
    );
    if (idx === -1) return [];
    const startLine = sectionStarts[idx].lineIdx + 1;
    const endLine = idx + 1 < sectionStarts.length ? sectionStarts[idx + 1].lineIdx : lines.length;
    return lines.slice(startLine, endLine);
  }

  // Session Recap
  const recapLines = getSectionLines('Session Recap');
  if (recapLines.length > 0) {
    const rawRecap = recapLines.join('\n').trim();
    if (rawRecap) {
      recap = stripImageRefs(rawRecap) || null;
    }
  }

  // Coaching Review
  const coachingLines = getSectionLines('Coaching Review');
  if (coachingLines.length > 0) {
    const raw = coachingLines.join('\n').trim();
    if (raw) coachingReview = raw;
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Parse trade blocks from ### Winning Trades / ### Losing Trades
  // ---------------------------------------------------------------------------
  const trades: ParsedTrade[] = [];

  // Find Trades section
  const tradeSectionIdx = sectionStarts.findIndex(
    (s) => s.name.toLowerCase() === 'trades',
  );
  if (tradeSectionIdx !== -1) {
    const tradesSectionStart = sectionStarts[tradeSectionIdx].lineIdx + 1;
    const tradesSectionEnd =
      tradeSectionIdx + 1 < sectionStarts.length
        ? sectionStarts[tradeSectionIdx + 1].lineIdx
        : lines.length;
    const tradeLines = lines.slice(tradesSectionStart, tradesSectionEnd);

    // Split into sub-sections (### Winning / ### Losing)
    // Then within each, split into blocks by bold headers
    let inSubSection = false;
    let currentBlockLines: string[] = [];

    function flushTradeBlock(blockLines: string[]): void {
      if (!blockLines.length) return;
      // First non-empty line should be the bold header
      const headerLineIdx = blockLines.findIndex((l) => /^\*\*[A-Z]/.test(l));
      if (headerLineIdx === -1) return;

      const headerLine = blockLines[headerLineIdx];
      const parsed = parseTradeHeader(headerLine);
      if (!parsed) return;

      const { underlying, putCall, pnl } = parsed;

      // Parse bullet fields from remaining lines
      let setupNumber: number | null = null;
      let thesis: string | null = null;
      let executionNotes: string | null = null;
      let grade: string | null = null;
      let outcomeText: string | null = null;
      const tradeImages: string[] = extractImages(blockLines.join('\n'));

      // We'll scan lines for "- **Field:**" patterns
      let j = headerLineIdx + 1;
      while (j < blockLines.length) {
        const l = blockLines[j];

        // Setup bullet
        const setupMatch = l.match(/^-\s+\*\*Setup:\*\*\s*(.*)/);
        if (setupMatch) {
          setupNumber = parseSetupNumber(setupMatch[1]);
          j++;
          continue;
        }

        // Thesis bullet
        const thesisMatch = l.match(/^-\s+\*\*Thesis:\*\*\s*(.*)/);
        if (thesisMatch) {
          let val = thesisMatch[1];
          j++;
          // Collect continuation lines (indented or non-bullet)
          while (j < blockLines.length && !blockLines[j].match(/^-\s+\*\*[A-Z]/)) {
            val += '\n' + blockLines[j];
            j++;
          }
          thesis = val.trim() || null;
          continue;
        }

        // Outcome bullet (early format) — capture separately for pnl hint extraction
        const outcomeMatch = l.match(/^-\s+\*\*Outcome:\*\*\s*(.*)/);
        if (outcomeMatch) {
          let val = outcomeMatch[1];
          j++;
          while (j < blockLines.length && !blockLines[j].match(/^-\s+\*\*[A-Z]/)) {
            val += '\n' + blockLines[j];
            j++;
          }
          outcomeText = val.trim() || null;
          continue;
        }

        // Execution bullet (later format)
        const execMatch = l.match(/^-\s+\*\*(?:Execution|Exec):\*\*\s*(.*)/);
        if (execMatch) {
          let val = execMatch[1];
          j++;
          while (j < blockLines.length && !blockLines[j].match(/^-\s+\*\*[A-Z]/)) {
            val += '\n' + blockLines[j];
            j++;
          }
          executionNotes = val.trim() || null;
          continue;
        }

        // Grade bullet
        const gradeMatch = l.match(/^-\s+\*\*Grade:\*\*\s*(.*)/);
        if (gradeMatch) {
          grade = parseGrade(gradeMatch[1]);
          j++;
          continue;
        }

        j++;
      }

      // For early-format entries, Outcome contains both PnL info and execution notes
      // Merge Outcome into executionNotes if no separate Execution field
      if (outcomeText && !executionNotes) {
        executionNotes = outcomeText;
      } else if (outcomeText && executionNotes) {
        executionNotes = `${outcomeText}\n${executionNotes}`;
      }

      // Extract a PnL hint from the outcome text (for matching when header has no $)
      const outcomePnlHint = outcomeText ? extractOutcomePnlHint(outcomeText) : null;

      trades.push({
        underlying,
        putCall,
        pnl,
        outcomePnlHint,
        setupNumber,
        thesis,
        executionNotes,
        grade,
        images: tradeImages,
      });
    }

    for (const l of tradeLines) {
      // Start of a new sub-section (### Winning / ### Losing)
      if (/^###/.test(l)) {
        if (inSubSection && currentBlockLines.length > 0) {
          flushTradeBlock(currentBlockLines);
        }
        currentBlockLines = [];
        inSubSection = true;
        continue;
      }

      if (!inSubSection) continue;

      // Horizontal rule separates trade blocks within a sub-section
      if (/^---/.test(l)) {
        flushTradeBlock(currentBlockLines);
        currentBlockLines = [];
        continue;
      }

      currentBlockLines.push(l);
    }
    // Flush last block
    if (inSubSection && currentBlockLines.length > 0) {
      flushTradeBlock(currentBlockLines);
    }
  }

  return {
    sessionDate: fileDate,
    sentiment,
    mood,
    sleepScore,
    sleepMinutes,
    marketContext,
    recap,
    journalPnl,
    coachingReview,
    trades,
    sessionImages,
  };
}
