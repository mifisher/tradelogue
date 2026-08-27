import { describe, it, expect } from 'vitest';
import { ALL_DETECTORS, DEFAULT_RULE_CONFIGS, DETECTOR_TEMPLATES, detectViolations } from './rules';
import type { RuleConfig, RuleTrade, SessionInput } from './rules';

// ── helper ─────────────────────────────────────────────────────────────────

let seq = 0;
function mkTrade(over: Partial<RuleTrade> = {}): RuleTrade {
  seq += 1;
  return {
    firstExecId: `exec-${seq}`,
    underlying: 'NVDA',
    expiry: '2026-06-20',          // not same-day (session 2026-06-08)
    openedAt: new Date('2026-06-08T14:30:00Z'),  // 10:30 ET — fine for R21
    closedAt: new Date('2026-06-08T15:00:00Z'),
    quantityOpened: 1,
    avgEntryPrice: 1.0,            // outlay = $100 — fine for R1
    realizedPnl: 50,
    ...over,
  };
}

// A fresh install seeds ONE rule (see DEFAULT_RULE_CONFIGS). These tests
// exercise the whole detection engine, so they run against the seeded rule
// plus every copy-in template.
const ALL_RULES = [...DEFAULT_RULE_CONFIGS, ...DETECTOR_TEMPLATES];
const detect = (input: SessionInput) => detectViolations(input, ALL_RULES);

function session(over: Partial<SessionInput> = {}): SessionInput {
  return {
    sessionDate: '2026-06-08',
    sentiment: 'Bullish',
    trades: [],
    ...over,
  };
}

// ── Empty input ─────────────────────────────────────────────────────────────

describe('detectViolations — empty', () => {
  it('returns [] for a session with no trades', () => {
    expect(detect(session())).toEqual([]);
  });
});

// ── Configurable catalog ────────────────────────────────────────────────────

describe('detectViolations — configurable rules', () => {
  it('seeds exactly one sample rule — the rulebook is the user\'s to write', () => {
    expect(DEFAULT_RULE_CONFIGS).toHaveLength(1);
    expect(DEFAULT_RULE_CONFIGS[0]).toMatchObject({ rule: 1, detector: 'oversized-outlay' });
  });

  it('offers a copy-in template for every detector the engine implements', () => {
    const templated = DETECTOR_TEMPLATES.map((rule) => rule.detector);
    const seeded = DEFAULT_RULE_CONFIGS.map((rule) => rule.detector);
    expect([...seeded, ...templated].sort()).toEqual([...ALL_DETECTORS].sort());
    // Templates continue the numbering from the seed, with no collisions.
    expect(ALL_RULES.map((r) => r.rule)).toEqual(
      Array.from({ length: ALL_RULES.length }, (_, i) => i + 1),
    );
  });

  it('binds detectors by detector name, not by rule number', () => {
    // Same detector, renumbered — detection must follow the detector.
    const renumbered: RuleConfig[] = [
      { rule: 99, title: 'Renumbered cap', description: 'x', enabled: true, detector: 'oversized-outlay' },
    ];
    const violations = detectViolations(
      session({ trades: [mkTrade({ quantityOpened: 5, avgEntryPrice: 3.13 })] }),
      renumbered,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe(99);
  });

  it('uses active rule copy when reporting a violation', () => {
    const rules: RuleConfig[] = [
      {
        rule: 1,
        title: 'Custom size cap title',
        description: 'Custom sizing description',
        enabled: true,
        detector: 'oversized-outlay',
      },
    ];

    const violations = detectViolations(
      session({
        trades: [mkTrade({ quantityOpened: 5, avgEntryPrice: 3.13 })],
      }),
      rules,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: 1,
      title: 'Custom size cap title',
    });
  });

  it('does not report disabled mechanical rules', () => {
    const rules: RuleConfig[] = [
      {
        rule: 1,
        title: 'Oversized outlay',
        description: 'Disabled for this account',
        enabled: false,
        detector: 'oversized-outlay',
      },
    ];

    const violations = detectViolations(
      session({
        trades: [mkTrade({ quantityOpened: 5, avgEntryPrice: 3.13 })],
      }),
      rules,
    );

    expect(violations.filter((v) => v.rule === 1)).toHaveLength(0);
  });

  it('does not report mechanical rules missing from a provided catalog', () => {
    const violations = detectViolations(
      session({
        sentiment: 'Uncertain',
        trades: [
          mkTrade({ quantityOpened: 5, avgEntryPrice: 3.13 }),
          mkTrade(),
          mkTrade(),
          mkTrade(),
        ],
      }),
      [],
    );

    expect(violations).toEqual([]);
  });
});

// ── R1 Oversized outlay ─────────────────────────────────────────────────────

describe('R1 — Oversized outlay', () => {
  it('fires when outlay exceeds the $1,000 cap (5 contracts × $2.13 × 100 = $1,065)', () => {
    const violations = detect(session({
      trades: [mkTrade({ quantityOpened: 5, avgEntryPrice: 2.13 })],
    }));
    const r1 = violations.filter((v) => v.rule === 1);
    expect(r1).toHaveLength(1);
    expect(r1[0].detail).toContain('$1,065');
    expect(r1[0].detail).toContain('$1,000');
    expect(r1[0].scope).toBe('trade');
    expect(r1[0].firstExecId).toBeDefined();
  });

  it('does NOT fire when outlay is exactly the $1,000 cap (5 × $2.00 × 100)', () => {
    const violations = detect(session({
      trades: [mkTrade({ quantityOpened: 5, avgEntryPrice: 2.0 })],
    }));
    expect(violations.filter((v) => v.rule === 1)).toHaveLength(0);
  });

  it('does NOT fire when outlay is just below cap', () => {
    // 14 × 0.71 × 100 = 994
    const violations = detect(session({
      trades: [mkTrade({ quantityOpened: 14, avgEntryPrice: 0.71 })],
    }));
    expect(violations.filter((v) => v.rule === 1)).toHaveLength(0);
  });
});

// ── R4 Re-entry without pause ───────────────────────────────────────────────

describe('R2 — Re-entry without pause', () => {
  it('fires when re-entering the same name < 10 min after a losing exit', () => {
    // First NVDA trade: closed at 14:00Z, realized -$50
    // Second NVDA trade: opened at 14:08Z (8 min gap < 10)
    const t1 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T13:50:00Z'),
      closedAt: new Date('2026-06-08T14:00:00Z'),
      realizedPnl: -50,
    });
    const t2 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T14:08:00Z'),
      closedAt: new Date('2026-06-08T14:30:00Z'),
    });
    const violations = detect(session({ trades: [t1, t2] }));
    const r2 = violations.filter((v) => v.rule === 2);
    expect(r2).toHaveLength(1);
    expect(r2[0].detail).toContain('NVDA');
    expect(r2[0].detail).toMatch(/8m/);
    expect(r2[0].scope).toBe('trade');
  });

  it('does NOT fire when the gap is exactly 10 minutes', () => {
    const t1 = mkTrade({
      underlying: 'NVDA',
      closedAt: new Date('2026-06-08T14:00:00Z'),
      realizedPnl: -50,
    });
    const t2 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T14:10:00Z'),
      closedAt: new Date('2026-06-08T14:30:00Z'),
    });
    const violations = detect(session({ trades: [t1, t2] }));
    expect(violations.filter((v) => v.rule === 2)).toHaveLength(0);
  });

  it('does NOT fire when re-entering after a WIN', () => {
    const t1 = mkTrade({
      underlying: 'NVDA',
      closedAt: new Date('2026-06-08T14:00:00Z'),
      realizedPnl: 75,
    });
    const t2 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T14:04:00Z'),
      closedAt: new Date('2026-06-08T14:30:00Z'),
    });
    const violations = detect(session({ trades: [t1, t2] }));
    expect(violations.filter((v) => v.rule === 2)).toHaveLength(0);
  });

  it('does NOT fire when re-entering a DIFFERENT underlying quickly after a loss', () => {
    const t1 = mkTrade({
      underlying: 'NVDA',
      closedAt: new Date('2026-06-08T14:00:00Z'),
      realizedPnl: -50,
    });
    const t2 = mkTrade({
      underlying: 'QQQ',
      openedAt: new Date('2026-06-08T14:03:00Z'),
      closedAt: new Date('2026-06-08T14:30:00Z'),
    });
    const violations = detect(session({ trades: [t1, t2] }));
    expect(violations.filter((v) => v.rule === 2)).toHaveLength(0);
  });
});

// ── R6 Multiple names at once ───────────────────────────────────────────────

describe('R3 — Multiple names at once', () => {
  it('fires when a different underlying opens while another is still open', () => {
    // NOW open 06:59 → 07:06, QQQ opens 07:00 while NOW still open
    const tNow = mkTrade({
      underlying: 'NOW',
      openedAt: new Date('2026-06-08T13:59:00Z'),
      closedAt: new Date('2026-06-08T14:06:00Z'),
    });
    const tQqq = mkTrade({
      underlying: 'QQQ',
      openedAt: new Date('2026-06-08T14:00:00Z'),
      closedAt: new Date('2026-06-08T14:09:00Z'),
    });
    const violations = detect(session({ trades: [tNow, tQqq] }));
    const r3 = violations.filter((v) => v.rule === 3);
    expect(r3).toHaveLength(1);
    expect(r3[0].detail).toContain('QQQ');
    expect(r3[0].detail).toContain('NOW');
    expect(r3[0].scope).toBe('trade');
  });

  it('does NOT fire when two trades on the SAME underlying overlap (scaling)', () => {
    const t1 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T13:30:00Z'),
      closedAt: new Date('2026-06-08T14:00:00Z'),
    });
    const t2 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T13:45:00Z'),
      closedAt: new Date('2026-06-08T14:15:00Z'),
    });
    const violations = detect(session({ trades: [t1, t2] }));
    expect(violations.filter((v) => v.rule === 3)).toHaveLength(0);
  });

  it('does NOT fire when a later trade opens exactly when the first closes', () => {
    const t1 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T13:30:00Z'),
      closedAt: new Date('2026-06-08T14:00:00Z'),
    });
    const t2 = mkTrade({
      underlying: 'QQQ',
      openedAt: new Date('2026-06-08T14:00:00Z'),
      closedAt: new Date('2026-06-08T14:30:00Z'),
    });
    const violations = detect(session({ trades: [t1, t2] }));
    // Overlap check: b.openedAt < a.closedAt — 14:00 < 14:00 is false → no violation
    expect(violations.filter((v) => v.rule === 3)).toHaveLength(0);
  });
});

// ── R13 Zero-DTE contract ───────────────────────────────────────────────────

describe('R4 — Zero-DTE contract', () => {
  it('fires when expiry equals the session date', () => {
    const violations = detect(session({
      sessionDate: '2026-06-08',
      trades: [mkTrade({ expiry: '2026-06-08' })],
    }));
    const r4 = violations.filter((v) => v.rule === 4);
    expect(r4).toHaveLength(1);
    expect(r4[0].detail).toContain('2026-06-08');
    expect(r4[0].scope).toBe('trade');
  });

  it('does NOT fire when expiry is the next day', () => {
    const violations = detect(session({
      sessionDate: '2026-06-08',
      trades: [mkTrade({ expiry: '2026-06-09' })],
    }));
    expect(violations.filter((v) => v.rule === 4)).toHaveLength(0);
  });

  it('does NOT fire when expiry is null (stock)', () => {
    const violations = detect(session({
      trades: [mkTrade({ expiry: null })],
    }));
    expect(violations.filter((v) => v.rule === 4)).toHaveLength(0);
  });
});

// ── R15 Overtrading a chop day ──────────────────────────────────────────────

describe('R5 — Overtrading a chop day', () => {
  it('fires when Uncertain AND more than 3 trades', () => {
    const violations = detect(session({
      sentiment: 'Uncertain',
      trades: [mkTrade(), mkTrade(), mkTrade(), mkTrade()], // 4 > 3
    }));
    const r5 = violations.filter((v) => v.rule === 5);
    expect(r5).toHaveLength(1);
    expect(r5[0].detail).toContain('4');
    expect(r5[0].detail).toContain('3');
    expect(r5[0].scope).toBe('session');
  });

  it('does NOT fire when exactly 3 trades on Uncertain day', () => {
    const violations = detect(session({
      sentiment: 'Uncertain',
      trades: [mkTrade(), mkTrade(), mkTrade()],
    }));
    expect(violations.filter((v) => v.rule === 5)).toHaveLength(0);
  });

  it('does NOT fire when 4 trades on Bullish day', () => {
    const violations = detect(session({
      sentiment: 'Bullish',
      trades: [mkTrade(), mkTrade(), mkTrade(), mkTrade()],
    }));
    expect(violations.filter((v) => v.rule === 5)).toHaveLength(0);
  });

  it('does NOT fire when sentiment is null (unjournaled) even with many trades', () => {
    const violations = detect(session({
      sentiment: null,
      trades: [mkTrade(), mkTrade(), mkTrade(), mkTrade(), mkTrade()],
    }));
    expect(violations.filter((v) => v.rule === 5)).toHaveLength(0);
  });
});

// ── R18 Trading through the circuit breaker ─────────────────────────────────

describe('R6 — Trading through the circuit breaker', () => {
  it('fires when a trade opens after cumulative PnL crosses -$500', () => {
    // -300 then -250 → cumPnl = -550 after trade 2 (≤ -500), trade 3 opens afterward
    const t1 = mkTrade({
      openedAt: new Date('2026-06-08T13:30:00Z'),
      closedAt: new Date('2026-06-08T13:45:00Z'),
      realizedPnl: -300,
    });
    const t2 = mkTrade({
      openedAt: new Date('2026-06-08T13:50:00Z'),
      closedAt: new Date('2026-06-08T14:05:00Z'),
      realizedPnl: -250,
    });
    const t3 = mkTrade({
      openedAt: new Date('2026-06-08T14:10:00Z'),
      closedAt: new Date('2026-06-08T14:30:00Z'),
      realizedPnl: 50,
    });
    const violations = detect(session({ trades: [t1, t2, t3] }));
    const r6 = violations.filter((v) => v.rule === 6);
    expect(r6).toHaveLength(1);
    expect(r6[0].detail).toContain('-$550');
    expect(r6[0].detail).toContain('-$500');
    expect(r6[0].scope).toBe('session');
  });

  it('does NOT fire when the day ends at -$600 with no later trades opening', () => {
    const t1 = mkTrade({
      openedAt: new Date('2026-06-08T13:30:00Z'),
      closedAt: new Date('2026-06-08T13:45:00Z'),
      realizedPnl: -350,
    });
    const t2 = mkTrade({
      openedAt: new Date('2026-06-08T13:50:00Z'),
      closedAt: new Date('2026-06-08T14:05:00Z'),
      realizedPnl: -250,
    });
    // cumPnl = -600 at end — but no trade opens afterward
    const violations = detect(session({ trades: [t1, t2] }));
    expect(violations.filter((v) => v.rule === 6)).toHaveLength(0);
  });

  it('fires when PnL reaches exactly -$500 and a later trade opens', () => {
    // exactly -500 must still fire (≤ -500)
    const t1 = mkTrade({
      openedAt: new Date('2026-06-08T13:30:00Z'),
      closedAt: new Date('2026-06-08T13:45:00Z'),
      realizedPnl: -500,
    });
    const t2 = mkTrade({
      openedAt: new Date('2026-06-08T13:50:00Z'),
      closedAt: new Date('2026-06-08T14:00:00Z'),
      realizedPnl: 50,
    });
    // cumPnl = -500 ≤ -500 → breached, and t2 opens after → should fire
    const violations = detect(session({ trades: [t1, t2] }));
    const r6 = violations.filter((v) => v.rule === 6);
    expect(r6).toHaveLength(1);
  });

  it('does NOT fire when the session is a winning day', () => {
    const violations = detect(session({
      trades: [
        mkTrade({ realizedPnl: 100 }),
        mkTrade({ openedAt: new Date('2026-06-08T15:00:00Z'), realizedPnl: 200 }),
      ],
    }));
    expect(violations.filter((v) => v.rule === 6)).toHaveLength(0);
  });
});

// ── R21 Opening-range entry ─────────────────────────────────────────────────

describe('R7 — Opening-range entry', () => {
  it('fires when trade opens at 09:56 ET (13:56 UTC in summer)', () => {
    // 13:56 UTC = 09:56 EDT (UTC-4)
    const violations = detect(session({
      trades: [mkTrade({ openedAt: new Date('2026-06-08T13:56:00Z') })],
    }));
    const r7 = violations.filter((v) => v.rule === 7);
    expect(r7).toHaveLength(1);
    expect(r7[0].detail).toContain('09:56');
    expect(r7[0].scope).toBe('trade');
  });

  it('does NOT fire when trade opens at exactly 10:00 ET (14:00 UTC)', () => {
    // 14:00 UTC = 10:00 EDT — exactly 10, not < 10
    const violations = detect(session({
      trades: [mkTrade({ openedAt: new Date('2026-06-08T14:00:00Z') })],
    }));
    expect(violations.filter((v) => v.rule === 7)).toHaveLength(0);
  });

  it('does NOT fire when trade opens at 10:30 ET', () => {
    const violations = detect(session({
      trades: [mkTrade({ openedAt: new Date('2026-06-08T14:30:00Z') })],
    }));
    expect(violations.filter((v) => v.rule === 7)).toHaveLength(0);
  });
});

// ── Multiple violations on one trade ───────────────────────────────────────

describe('multiple violations — one trade can trigger R1 + R21', () => {
  it('detects both R1 and R21 on an opening-range oversized trade', () => {
    // 5 contracts × $4.00 × 100 = $2,000 > $1,000  AND  09:35 ET
    const violations = detect(session({
      trades: [mkTrade({
        quantityOpened: 5,
        avgEntryPrice: 4.0,
        openedAt: new Date('2026-06-08T13:35:00Z'), // 09:35 EDT
      })],
    }));
    expect(violations.filter((v) => v.rule === 1)).toHaveLength(1);
    expect(violations.filter((v) => v.rule === 7)).toHaveLength(1);
  });
});

// ── Detail string spot-checks ───────────────────────────────────────────────

describe('detail string formatting', () => {
  it('R4 detail includes the underlying and gap in minutes', () => {
    const t1 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T13:50:00Z'),
      closedAt: new Date('2026-06-08T14:00:00Z'),
      realizedPnl: -50,
    });
    const t2 = mkTrade({
      underlying: 'NVDA',
      openedAt: new Date('2026-06-08T14:04:00Z'),
      closedAt: new Date('2026-06-08T14:20:00Z'),
    });
    const r2 = detect(session({ trades: [t1, t2] })).filter((v) => v.rule === 2);
    expect(r2[0].detail).toMatch(/Re-entered NVDA/);
    expect(r2[0].detail).toMatch(/4m/);
  });

  it('R6 detail includes both tickers and opened-while phrasing', () => {
    const tA = mkTrade({
      underlying: 'NOW',
      openedAt: new Date('2026-06-08T13:59:00Z'),
      closedAt: new Date('2026-06-08T14:06:00Z'),
    });
    const tB = mkTrade({
      underlying: 'QQQ',
      openedAt: new Date('2026-06-08T14:00:23Z'),
      closedAt: new Date('2026-06-08T14:09:25Z'),
    });
    const r3 = detect(session({ trades: [tA, tB] })).filter((v) => v.rule === 3);
    expect(r3[0].detail).toMatch(/QQQ/);
    expect(r3[0].detail).toMatch(/NOW/);
  });

  it('R21 detail includes the actual local time', () => {
    // 13:35 UTC = 06:35 PDT
    const violations = detect(session({
      trades: [mkTrade({ openedAt: new Date('2026-06-08T13:35:00Z') })],
    }));
    const r7 = violations.filter((v) => v.rule === 7);
    expect(r7[0].detail).toContain('09:35');
  });
});
