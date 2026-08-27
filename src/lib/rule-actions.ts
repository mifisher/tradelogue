'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tradingRules } from '@/db/schema';
import { nextTradingRuleNumber } from '@/lib/trading-rules';

export interface RuleInput {
  title: string;
  description: string;
  enabled?: boolean;
}

function safeRevalidate(path: string, type?: 'page' | 'layout') {
  try {
    revalidatePath(path, type);
  } catch {
    // ignore Next.js context errors outside request handling
  }
}

function cleanRuleInput(input: RuleInput): Required<RuleInput> {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title) throw new Error('Rule title is required');
  if (!description) throw new Error('Rule description is required');

  return {
    title,
    description,
    enabled: input.enabled ?? true,
  };
}

function revalidateRuleConsumers() {
  safeRevalidate('/', 'layout');
}

export async function createTradingRule(input: RuleInput): Promise<{ id: number; ruleNumber: number }> {
  const fields = cleanRuleInput(input);
  const ruleNumber = await nextTradingRuleNumber();

  const rows = await db
    .insert(tradingRules)
    .values({
      ruleNumber,
      title: fields.title,
      description: fields.description,
      enabled: fields.enabled,
      detector: null,
      source: 'manual',
    })
    .returning({ id: tradingRules.id, ruleNumber: tradingRules.ruleNumber });

  revalidateRuleConsumers();
  return rows[0];
}

export async function updateTradingRule(id: number, input: RuleInput): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Rule id is required');
  const fields = cleanRuleInput(input);

  await db
    .update(tradingRules)
    .set({
      title: fields.title,
      description: fields.description,
      enabled: fields.enabled,
      updatedAt: new Date(),
    })
    .where(eq(tradingRules.id, id));

  revalidateRuleConsumers();
}

export async function toggleTradingRule(id: number, enabled: boolean): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Rule id is required');

  await db
    .update(tradingRules)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(eq(tradingRules.id, id));

  revalidateRuleConsumers();
}

export async function deleteTradingRule(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Rule id is required');

  await db
    .update(tradingRules)
    .set({
      enabled: false,
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tradingRules.id, id));

  revalidateRuleConsumers();
}
