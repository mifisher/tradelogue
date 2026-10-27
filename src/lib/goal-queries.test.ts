import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const checkinRows = vi.fn(async () => [{ goalId: 2, sessionDate: '2026-10-02', hit: false }]);
  const where = vi.fn(() => checkinRows());
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    select, where,
    closedTrades: vi.fn(async () => [{
      id: 1, firstExecId: 'e1', underlying: 'NVDA', expiry: '2099-01-01', sessionDate: '2026-10-02',
      openedAt: new Date('2026-10-02T15:00:00Z'), closedAt: new Date('2026-10-02T15:30:00Z'),
      quantityOpened: 1, avgEntryPrice: 1, realizedPnl: 50,
    }]),
    sentimentByDate: vi.fn(async () => new Map([['2026-10-02', 'Bullish']])),
    journaledDates: vi.fn(async () => new Set(['2026-10-02'])),
  };
});

vi.mock('@/db', () => ({ db: { select: mocks.select } }));
vi.mock('@/lib/queries', () => ({
  closedTrades: mocks.closedTrades,
  sentimentByDate: mocks.sentimentByDate,
  journaledDates: mocks.journaledDates,
}));

const goal = (id: number, checkType: string) => ({
  id, title: `g${id}`, hypothesis: 'h', protocol: 'p', successMetric: 's',
  checkType, threshold: checkType === 'self-report' ? null : 3, targetSessions: 10,
  startedOn: '2026-10-01', closedOn: null, status: 'completed', ruleId: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
});

describe('loadGoalViews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads trades and checkins once for any number of goals', async () => {
    const { loadGoalViews } = await import('./goal-queries');
    const views = await loadGoalViews([goal(1, 'max-trades-per-session'), goal(2, 'self-report'), goal(3, 'no-zero-dte')] as never);
    expect(mocks.closedTrades).toHaveBeenCalledTimes(1);
    expect(mocks.select).toHaveBeenCalledTimes(1); // one checkins query for all goals
    expect(views.map((v) => v.evaluation.hits)).toEqual([1, 0, 1]);
    expect(views[1].evaluation.results[0]).toMatchObject({ sessionDate: '2026-10-02', hit: false });
  });

  it('skips the checkins query when there are no goals', async () => {
    const { loadGoalViews } = await import('./goal-queries');
    expect(await loadGoalViews([])).toEqual([]);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.closedTrades).not.toHaveBeenCalled();
  });
});
