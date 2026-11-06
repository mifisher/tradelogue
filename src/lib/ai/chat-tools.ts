// ── Chat tools — read-only data tools for the /coach agentic loop ──────────
// Five tools expose trading data to the configured model. Each description is prescriptive
// (tells the model WHEN to call the tool) per Anthropic best practices.

import {
  closedTrades,
  dailySummaries,
  getSession,
  getAnnotationsByExecIds,
  getSetups,
  tradesForAllSetups,
  toStatTrade,
  sentimentByDate,
  type TradeFilters,
} from '@/lib/queries';
import { computeStats } from '@/lib/stats';
import { disciplineOverview, violationsForSession } from '@/lib/discipline';
import { RULES, minutesAfterOpen } from '@/lib/rules';
import { fmtMoney, fmtHold } from '@/lib/format';
import { getRuleConfigs } from '@/lib/trading-rules';
import { TRADING_TIMEZONE, timezoneLabel } from '@/lib/config';

// ── PT time formatter ────────────────────────────────────────────────────────

const TZ_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function localTime(d: Date): string {
  return TZ_TIME.format(d);
}

// ── Tool definitions ─────────────────────────────────────────────────────────

interface ChatTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const CHAT_TOOLS: ChatTool[] = [
  {
    name: 'get_daily_pnl',
    description:
      'Call this tool to retrieve the trader\'s day-by-day P&L and trade count summary. ' +
      'Use it when the user asks about performance over a time range, equity trends, best/worst days, ' +
      'streaks, or any question that requires comparing multiple sessions at once. ' +
      'Provide from/to (YYYY-MM-DD) to narrow the range; omit both for all-time data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Start date inclusive, YYYY-MM-DD. Omit for all-time.',
        },
        to: {
          type: 'string',
          description: 'End date inclusive, YYYY-MM-DD. Omit for all-time.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_trades',
    description:
      'Call this tool to retrieve individual trade records — entries, exits, P&L, setup tags, and grades. ' +
      'Use it when the user asks about specific trades, a particular ticker, a certain date\'s trades, ' +
      'worst losses, best wins, or wants to drill into annotated setup/grade data. ' +
      'Filter by date or date range, underlying ticker, result (win/loss), setup number, and entry time ' +
      'relative to the 9:30 ET market open. The response includes a `summary` (count, win rate, total P&L) ' +
      'computed over ALL matching trades, not just the returned page — use it for aggregate comparisons ' +
      '(e.g. setup 4 in the first 30 min after open vs. later: call once with max_minutes_after_open=30 and ' +
      'min_minutes_after_open=0, once with min_minutes_after_open=30). ' +
      'Default limit is 20; increase up to 50 for broader queries. Never omit the limit — ' +
      'the database has hundreds of trades and this tool will refuse to return them all.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: {
          type: 'string',
          description: 'Filter to a single session date, YYYY-MM-DD.',
        },
        from: {
          type: 'string',
          description: 'Start session date inclusive, YYYY-MM-DD.',
        },
        to: {
          type: 'string',
          description: 'End session date inclusive, YYYY-MM-DD.',
        },
        setup: {
          type: 'number',
          description: 'Filter to trades tagged with this setup number (1-4).',
        },
        min_minutes_after_open: {
          type: 'number',
          description: 'Only trades entered at least this many minutes after the 9:30 ET open (inclusive). Pre-market entries are negative.',
        },
        max_minutes_after_open: {
          type: 'number',
          description: 'Only trades entered fewer than this many minutes after the 9:30 ET open (exclusive).',
        },
        underlying: {
          type: 'string',
          description: 'Filter to a specific ticker symbol, e.g. "SPY", "NVDA".',
        },
        result: {
          type: 'string',
          enum: ['win', 'loss'],
          description: 'Filter to winning (pnl > 0) or losing (pnl ≤ 0) trades only.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of trades to return (default 20, max 50).',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_session',
    description:
      'Call this tool to get the journal entry and rule violations for a single session date. ' +
      'Use it when the user asks about a specific day — the tape classification (Bullish/Bearish/Uncertain), ' +
      'mood, sleep, market context, written recap, journal P&L, or which rules were violated that day. ' +
      'Requires an exact date (YYYY-MM-DD).',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: {
          type: 'string',
          description: 'The session date to look up, YYYY-MM-DD.',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_violation_summary',
    description:
      'Call this tool to get all-time discipline statistics: how many times each rule was violated, ' +
      'which sessions were affected, the P&L impact, and a clean-vs-violated session comparison. ' +
      'Use it when the user asks which rule costs the most, how clean their record is, ' +
      'violation frequency, or any discipline/rulebook question that spans the whole trading history.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_setup_stats',
    description:
      'Call this tool to get performance statistics broken down by the ' +
      "trader's own named setups, as defined in their setups table. " +
      'Use it when the user asks which setup performs best, win rates by setup, ' +
      'P&L by setup, or any question comparing their named entry patterns. ' +
      'The tool returns the setup names, so do not assume them up front.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'get_daily_pnl': {
        const from = typeof input.from === 'string' ? input.from : undefined;
        const to = typeof input.to === 'string' ? input.to : undefined;

        let days = await dailySummaries();

        if (from) days = days.filter((d) => d.day >= from);
        if (to) days = days.filter((d) => d.day <= to);

        return JSON.stringify({ count: days.length, days });
      }

      case 'list_trades': {
        const rawLimit = typeof input.limit === 'number' ? input.limit : 20;
        const limit = Math.min(Math.max(1, rawLimit), 50);

        const filters: TradeFilters = {};
        if (typeof input.from === 'string') filters.from = input.from;
        if (typeof input.to === 'string') filters.to = input.to;
        if (typeof input.date === 'string') {
          filters.from = input.date;
          filters.to = input.date;
        }
        if (typeof input.underlying === 'string') filters.underlying = input.underlying;
        if (input.result === 'win' || input.result === 'loss') filters.result = input.result;
        const setup = typeof input.setup === 'number' ? input.setup : undefined;
        const minAfter = typeof input.min_minutes_after_open === 'number' ? input.min_minutes_after_open : undefined;
        const maxAfter = typeof input.max_minutes_after_open === 'number' ? input.max_minutes_after_open : undefined;

        const all = await closedTrades(filters);
        // Annotations for every match, since the setup filter needs them.
        const execIds = all.map((r) => r.firstExecId).filter((id): id is string => id !== null);
        const annotations = await getAnnotationsByExecIds(execIds);

        const rows = all.filter((r) => {
          if (setup !== undefined && (r.firstExecId ? annotations.get(r.firstExecId)?.setupNumber : null) !== setup) return false;
          const mins = minutesAfterOpen(r.openedAt);
          if (minAfter !== undefined && mins < minAfter) return false;
          if (maxAfter !== undefined && mins >= maxAfter) return false;
          return true;
        });
        const sliced = rows.slice(0, limit);
        const stats = computeStats(rows.filter((r) => r.realizedPnl !== null).map(toStatTrade));

        const compact = sliced.map((r) => {
          const ann = r.firstExecId ? annotations.get(r.firstExecId) : undefined;
          const holdMs = r.closedAt && r.openedAt
            ? r.closedAt.getTime() - r.openedAt.getTime()
            : null;
          return {
            ticker: r.underlying,
            date: r.sessionDate,
            time: localTime(r.openedAt),
            minutes_after_open: minutesAfterOpen(r.openedAt),
            direction: r.direction,
            qty: r.quantityOpened,
            entry: r.avgEntryPrice,
            exit: r.avgExitPrice ?? null,
            pnl: r.realizedPnl !== null ? fmtMoney(r.realizedPnl) : null,
            pnl_raw: r.realizedPnl,
            hold: holdMs !== null ? fmtHold(holdMs) : null,
            setup: ann?.setupNumber ?? null,
            grade: ann?.grade ?? null,
          };
        });

        return JSON.stringify({
          returned: compact.length,
          total_matching: rows.length,
          timezone: timezoneLabel(),
          summary: {
            trade_count: stats.tradeCount,
            win_count: stats.winCount,
            loss_count: stats.lossCount,
            win_rate: `${(stats.winRate * 100).toFixed(1)}%`,
            total_pnl: fmtMoney(stats.totalPnl),
            avg_pnl: stats.tradeCount ? fmtMoney(stats.totalPnl / stats.tradeCount) : null,
          },
          trades: compact,
        });
      }

      case 'get_session': {
        const date = typeof input.date === 'string' ? input.date : null;
        if (!date) return JSON.stringify({ error: 'date is required' });

        // Fetch session + trades for violations
        const [session, trades, ruleConfigs] = await Promise.all([
          getSession(date),
          closedTrades({ from: date, to: date }),
          getRuleConfigs(),
        ]);

        const violations = violationsForSession(
          date,
          trades,
          session?.sentiment ?? null,
          ruleConfigs,
        );

        return JSON.stringify({
          date,
          session: session
            ? {
                sentiment: session.sentiment,
                mood: session.mood,
                sleep_score: session.sleepScore,
                sleep_minutes: session.sleepMinutes,
                market_context: session.marketContext,
                recap: session.recap,
                journal_pnl: session.journalPnl,
              }
            : null,
          violations: violations.map((v) => ({
            rule: v.rule,
            title: v.title,
            scope: v.scope,
            detail: v.detail,
          })),
          trade_count: trades.length,
        });
      }

      case 'get_violation_summary': {
        const [allTrades, days, sentiments, ruleConfigs] = await Promise.all([
          closedTrades(),
          dailySummaries(),
          sentimentByDate(),
          getRuleConfigs(),
        ]);

        const overview = disciplineOverview(allTrades, sentiments, days, ruleConfigs);
        const descriptionByRule = new Map(
          ruleConfigs.map((rule) => [rule.rule, rule.description]),
        );

        // Augment byRule with rule descriptions
        const byRule = overview.byRule.map((r) => ({
          rule: r.rule,
          title: r.title,
          description: descriptionByRule.get(r.rule) ?? RULES[r.rule]?.description ?? '',
          violation_count: r.violationCount,
          sessions_affected: r.sessionsAffected,
          total_pnl_of_affected_sessions: fmtMoney(r.affectedPnl),
          affected_pnl_raw: r.affectedPnl,
        }));

        return JSON.stringify({
          clean_sessions: {
            count: overview.cleanSessions.count,
            avg_pnl: fmtMoney(overview.cleanSessions.avgPnl),
          },
          violated_sessions: {
            count: overview.violatedSessions.count,
            avg_pnl: fmtMoney(overview.violatedSessions.avgPnl),
          },
          by_rule: byRule,
        });
      }

      case 'get_setup_stats': {
        const [setupTradesMap, setupRows] = await Promise.all([
          tradesForAllSetups(),
          getSetups(),
        ]);

        const setupStats = setupRows.map((setup) => {
          const tradeRows = setupTradesMap.get(setup.number) ?? [];
          const statTrades = tradeRows.map(toStatTrade);
          const stats = computeStats(statTrades);
          return {
            setup_number: setup.number,
            setup_name: setup.name,
            trade_count: stats.tradeCount,
            win_count: stats.winCount,
            loss_count: stats.lossCount,
            win_rate: `${(stats.winRate * 100).toFixed(1)}%`,
            total_pnl: fmtMoney(stats.totalPnl),
            total_pnl_raw: stats.totalPnl,
            avg_win: stats.avgWin !== null ? fmtMoney(stats.avgWin) : null,
            avg_loss: stats.avgLoss !== null ? fmtMoney(stats.avgLoss) : null,
            expectancy: fmtMoney(stats.expectancy),
            largest_win: stats.largestWin !== null ? fmtMoney(stats.largestWin) : null,
            largest_loss: stats.largestLoss !== null ? fmtMoney(stats.largestLoss) : null,
          };
        });

        // Also include unannotated totals for reference
        const allTrades = await closedTrades();
        const allStats = computeStats(allTrades.map(toStatTrade));
        const annotatedTradeCount = setupStats.reduce((s, r) => s + r.trade_count, 0);

        return JSON.stringify({
          setups: setupStats,
          annotation_coverage: {
            annotated_trades: annotatedTradeCount,
            total_trades: allStats.tradeCount,
            note: `${allStats.tradeCount - annotatedTradeCount} trades have no setup tag and are excluded from setup stats.`,
          },
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : 'Tool execution failed',
    });
  }
}
