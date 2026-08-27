import { asc, desc, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { tradingRules } from '@/db/schema';
import { ALL_DETECTORS, DEFAULT_RULE_CONFIGS } from '@/lib/rules';
import type { RuleConfig, RuleDetector } from '@/lib/rules';

export type TradingRuleRow = typeof tradingRules.$inferSelect;

// Every detector the engine implements — NOT just the ones the shipped seed
// happens to use. Deriving this from the seed would silently null out a valid
// detector on any rule the seed does not include.
const DETECTORS = new Set<RuleDetector>(ALL_DETECTORS);

function toDetector(value: string | null): RuleDetector | null {
  if (value === null) return null;
  return DETECTORS.has(value as RuleDetector) ? (value as RuleDetector) : null;
}

export function tradingRuleToConfig(row: TradingRuleRow): RuleConfig {
  return {
    rule: row.ruleNumber,
    title: row.title,
    description: row.description,
    enabled: row.enabled,
    detector: toDetector(row.detector),
  };
}

async function ensureDefaultTradingRules(): Promise<void> {
  const existing = await db
    .select({ ruleNumber: tradingRules.ruleNumber })
    .from(tradingRules)
    .where(inArray(
      tradingRules.ruleNumber,
      DEFAULT_RULE_CONFIGS.map((rule) => rule.rule),
    ));
  const existingNumbers = new Set(existing.map((row) => row.ruleNumber));
  const missingRules = DEFAULT_RULE_CONFIGS.filter((rule) => !existingNumbers.has(rule.rule));
  if (missingRules.length === 0) return;

  await db.insert(tradingRules).values(
    missingRules.map((rule) => ({
      ruleNumber: rule.rule,
      title: rule.title,
      description: rule.description,
      enabled: rule.enabled,
      detector: rule.detector,
      source: rule.detector === null ? 'manual' : 'mechanical',
    })),
  );
}

export async function getTradingRules(): Promise<TradingRuleRow[]> {
  await ensureDefaultTradingRules();

  return db
    .select()
    .from(tradingRules)
    .where(isNull(tradingRules.deletedAt))
    .orderBy(asc(tradingRules.ruleNumber));
}

export async function getRuleConfigs(): Promise<RuleConfig[]> {
  const rows = await getTradingRules();
  return rows.map(tradingRuleToConfig);
}

export async function nextTradingRuleNumber(): Promise<number> {
  const rows = await db
    .select({ ruleNumber: tradingRules.ruleNumber })
    .from(tradingRules)
    .orderBy(desc(tradingRules.ruleNumber))
    .limit(1);

  // Never reuse a number, and never collide with a seed rule that has not been
  // inserted yet.
  const highestSeeded = DEFAULT_RULE_CONFIGS.reduce((max, r) => Math.max(max, r.rule), 0);
  return Math.max(rows[0]?.ruleNumber ?? 0, highestSeeded) + 1;
}
