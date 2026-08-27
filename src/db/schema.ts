import {
  pgTable, serial, text, bigint, doublePrecision, timestamp, jsonb, integer, boolean,
} from 'drizzle-orm/pg-core';
import type { SetupSuggestion } from '../lib/setup-suggestions';
import type { PatternExperiment, PatternInsight } from '../lib/pattern-analysis';
import type { BriefQuotes, StoredBriefContent, BriefSourceLink } from '../lib/market/brief-schema';

export const executions = pgTable('executions', {
  id: serial('id').primaryKey(),
  execId: text('exec_id').notNull().unique(),
  accountId: text('account_id').notNull(),
  conid: bigint('conid', { mode: 'number' }).notNull(),
  underlying: text('underlying').notNull(),
  description: text('description').notNull(),
  assetCategory: text('asset_category').notNull(),
  expiry: text('expiry'),
  strike: doublePrecision('strike'),
  putCall: text('put_call'),
  multiplier: doublePrecision('multiplier').notNull().default(1),
  dateTime: timestamp('date_time', { withTimezone: true }).notNull(),
  quantity: doublePrecision('quantity').notNull(),
  price: doublePrecision('price').notNull(),
  proceeds: doublePrecision('proceeds').notNull(),
  commission: doublePrecision('commission').notNull(),
  raw: jsonb('raw').notNull(),
});

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  conid: bigint('conid', { mode: 'number' }).notNull(),
  underlying: text('underlying').notNull(),
  description: text('description').notNull(),
  expiry: text('expiry'),
  strike: doublePrecision('strike'),
  putCall: text('put_call'),
  direction: text('direction').notNull(),
  status: text('status').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  sessionDate: text('session_date'), // PT date of close, e.g. 2026-06-08
  quantityOpened: doublePrecision('quantity_opened').notNull(),
  avgEntryPrice: doublePrecision('avg_entry_price').notNull(),
  avgExitPrice: doublePrecision('avg_exit_price'),
  realizedPnl: doublePrecision('realized_pnl'),
  commissions: doublePrecision('commissions').notNull(),
  executionIds: jsonb('execution_ids').notNull(),
  firstExecId: text('first_exec_id'),
});

export const importBatches = pgTable('import_batches', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(), // 'file' | 'flex-api'
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  parsedCount: integer('parsed_count').notNull(),
  insertedCount: integer('inserted_count').notNull(),
  tradeCount: integer('trade_count').notNull(),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  sessionDate: text('session_date').notNull().unique(), // YYYY-MM-DD (PT)
  sentiment: text('sentiment'),            // 'Bullish' | 'Bearish' | 'Uncertain'
  mood: text('mood'),
  sleepScore: integer('sleep_score'),
  sleepMinutes: integer('sleep_minutes'),
  marketContext: text('market_context'),
  recap: text('recap'),
  coachingReview: text('coaching_review'), // verbatim from markdown journal; Phase 4 eval ground truth
  journalPnl: doublePrecision('journal_pnl'), // hand-recorded P/L from the markdown journal, for reference
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const setups = pgTable('setups', {
  id: serial('id').primaryKey(),
  number: integer('number').notNull().unique(), // 1..4 today
  name: text('name').notNull(),
  alsoCalled: text('also_called'),
  description: text('description'),
  whyItWorks: text('why_it_works'),
  entryCriteria: text('entry_criteria'),
  target: text('target'),
  management: text('management'),
  stopPlacement: text('stop_placement'),
  idealConditions: text('ideal_conditions'),
  watchOuts: text('watch_outs'),
});

export const tradeAnnotations = pgTable('trade_annotations', {
  id: serial('id').primaryKey(),
  firstExecId: text('first_exec_id').notNull().unique(), // stable across trades rebuilds
  setupNumber: integer('setup_number'),
  thesis: text('thesis'),
  executionNotes: text('execution_notes'),
  grade: text('grade'), // 'A+' … 'F'
  gradeReason: text('grade_reason'),
  setupSuggestion: jsonb('setup_suggestion').$type<SetupSuggestion | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tradingRules = pgTable('trading_rules', {
  id: serial('id').primaryKey(),
  ruleNumber: integer('rule_number').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  detector: text('detector'),
  source: text('source').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const coachingReviews = pgTable('coaching_reviews', {
  id: serial('id').primaryKey(),
  sessionDate: text('session_date').notNull().unique(),
  whatWorked: jsonb('what_worked').notNull(),      // string[]
  toImprove: jsonb('to_improve').notNull(),        // string[]
  patternsToWatch: jsonb('patterns_to_watch').notNull(), // string[]
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const patternAnalyses = pgTable('pattern_analyses', {
  id: serial('id').primaryKey(),
  scope: text('scope').notNull().unique(),
  dateRangeFrom: text('date_range_from').notNull(),
  dateRangeTo: text('date_range_to').notNull(),
  sessionsAnalyzed: integer('sessions_analyzed').notNull(),
  tradesAnalyzed: integer('trades_analyzed').notNull(),
  totalPnl: doublePrecision('total_pnl').notNull(),
  summary: text('summary').notNull(),
  topFocusAreas: jsonb('top_focus_areas').$type<PatternInsight[]>().notNull(),
  strengthsToLeanInto: jsonb('strengths_to_lean_into').$type<PatternInsight[]>().notNull(),
  recurringMistakes: jsonb('recurring_mistakes').$type<PatternInsight[]>().notNull(),
  blindSpots: jsonb('blind_spots').$type<PatternInsight[]>().notNull(),
  nextExperiments: jsonb('next_experiments').$type<PatternExperiment[]>().notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  sessionDate: text('session_date').notNull(), // attach at session level
  firstExecId: text('first_exec_id'), // null = session-level; set = tied to a specific trade
  fileName: text('file_name').notNull().unique(), // name within uploads/
  caption: text('caption'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const marketBriefs = pgTable('market_briefs', {
  id: serial('id').primaryKey(),
  briefDate: text('brief_date').notNull(), // YYYY-MM-DD (PT trading date)
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  trigger: text('trigger').notNull(),      // 'scheduled' | 'manual'
  status: text('status').notNull(),        // 'ok' | 'partial' | 'failed'
  quotes: jsonb('quotes').$type<BriefQuotes | null>(),
  brief: jsonb('brief').$type<StoredBriefContent | null>(),
  sources: jsonb('sources').$type<BriefSourceLink[]>().notNull().default([]),
  model: text('model'),
  error: text('error'),
});
