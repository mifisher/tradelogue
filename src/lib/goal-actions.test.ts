import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const values = vi.fn();
  const insert = vi.fn(() => ({ values }));
  return {
    insert, values, update, set, where,
    revalidatePath: vi.fn(),
    insertTradingRule: vi.fn(async () => ({ id: 77, ruleNumber: 23 })),
    // Transaction executor: the claim (conditional update … returning) and the link update.
    txReturning: vi.fn(),
    txWhere: vi.fn(),
    txSet: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
const tx = {
  update: vi.fn(() => ({
    set: (v: unknown) => {
      mocks.txSet(v);
      return { where: (w: unknown) => { mocks.txWhere(w); return { returning: mocks.txReturning }; } };
    },
  })),
};
vi.mock('@/db', () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/trading-rules', () => ({ insertTradingRule: mocks.insertTradingRule }));

const input = {
  title: 'Hard stop at 3 trades', hypothesis: 'h', protocol: 'p', successMetric: 's',
  targetSessions: 10, check: { type: 'max-trades-per-session', threshold: 3 },
};

describe('startGoal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a bad threshold without touching the db', async () => {
    const { startGoal } = await import('./goal-actions');
    const r = await startGoal({ ...input, check: { type: 'daily-loss-stop', threshold: 300 } });
    expect(r.ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('maps the one-active unique violation to a friendly error', async () => {
    mocks.values.mockRejectedValueOnce({ cause: { code: '23505' } });
    const { startGoal } = await import('./goal-actions');
    expect(await startGoal(input)).toEqual({ ok: false, error: 'A goal is already active' });
  });

  it('inserts an active goal', async () => {
    mocks.values.mockResolvedValueOnce(undefined);
    const { startGoal } = await import('./goal-actions');
    expect(await startGoal(input)).toEqual({ ok: true });
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      checkType: 'max-trades-per-session', threshold: 3, targetSessions: 10,
      startedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });
});

describe('promoteGoal', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.txReturning.mockReset(); });

  it('claims the goal, disables same-check rules, creates the rule, and links it — in one transaction', async () => {
    mocks.txReturning.mockResolvedValueOnce([{ id: 5, title: '$500 max outlay', protocol: 'Size down.', checkType: 'max-outlay-per-trade', threshold: 500 }]);
    const { promoteGoal } = await import('./goal-actions');
    expect(await promoteGoal(5)).toEqual({ ok: true });
    expect(mocks.txSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'promoted' }));
    expect(mocks.txSet).toHaveBeenNthCalledWith(2, { enabled: false, updatedAt: expect.any(Date) });
    expect(mocks.insertTradingRule).toHaveBeenCalledWith(tx, expect.objectContaining({
      title: '$500 max outlay', detector: 'oversized-outlay', threshold: 500,
    }));
    expect(mocks.txSet).toHaveBeenNthCalledWith(3, { ruleId: 77 });
  });

  it('disables nothing for a self-report goal (manual rule, no detector)', async () => {
    mocks.txReturning.mockResolvedValueOnce([{ id: 6, title: 'Stop before entry', protocol: 'p', checkType: 'self-report', threshold: null }]);
    const { promoteGoal } = await import('./goal-actions');
    expect(await promoteGoal(6)).toEqual({ ok: true });
    expect(mocks.txSet).toHaveBeenCalledTimes(2); // claim + link only
    expect(mocks.insertTradingRule).toHaveBeenCalledWith(tx, expect.objectContaining({ detector: null }));
  });

  it('creates no rule when the goal was already claimed (second tab / already closed)', async () => {
    mocks.txReturning.mockResolvedValueOnce([]);
    const { promoteGoal } = await import('./goal-actions');
    expect(await promoteGoal(5)).toEqual({ ok: false, error: 'This goal is already closed' });
    expect(mocks.insertTradingRule).not.toHaveBeenCalled();
    expect(mocks.txSet).toHaveBeenCalledTimes(1);
  });
});
