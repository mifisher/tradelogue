import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const revalidatePath = vi.fn();
  return { insert, onConflictDoUpdate, revalidatePath, set, update, values, where };
});

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/db', () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
  },
}));

describe('dismissSetupSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears only the saved setup suggestion and revalidates the affected pages', async () => {
    const { dismissSetupSuggestion } = await import('./journal-actions');

    await dismissSetupSuggestion('exec-123', '2026-06-25');

    expect(mocks.set).toHaveBeenCalledWith({
      setupSuggestion: null,
      updatedAt: expect.any(Date),
    });
    expect(mocks.where).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/setups');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/day/2026-06-25');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/trade/exec-123');
  });
});

describe('saveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts and persists Upbeat sentiment', async () => {
    const { saveSession } = await import('./journal-actions');

    await saveSession('2026-07-01', { sentiment: 'Upbeat' });

    expect(mocks.values).toHaveBeenCalledWith({
      sessionDate: '2026-07-01',
      sentiment: 'Upbeat',
      mood: null,
      sleepScore: null,
      sleepMinutes: null,
      marketContext: null,
      recap: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/day/2026-07-01');
  });
});

describe('prefillMarketContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts the overview but only fills when the field is empty', async () => {
    const { prefillMarketContext } = await import('./journal-actions');

    await prefillMarketContext('2026-07-24', '  Futures higher on chip strength.  ');

    // trimmed value inserted for a fresh row
    expect(mocks.values).toHaveBeenCalledWith({
      sessionDate: '2026-07-24',
      marketContext: 'Futures higher on chip strength.',
    });
    // the conflict update carries a setWhere guard so an existing value stays put
    const conflict = mocks.onConflictDoUpdate.mock.calls[0][0];
    expect(conflict.set.marketContext).toBe('Futures higher on chip strength.');
    expect(conflict.setWhere).toBeDefined();
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/day/2026-07-24');
  });

  it('does nothing when the overview is blank', async () => {
    const { prefillMarketContext } = await import('./journal-actions');

    await prefillMarketContext('2026-07-24', '   ');

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a malformed session date before touching the db', async () => {
    const { prefillMarketContext } = await import('./journal-actions');

    await expect(prefillMarketContext('07/24/2026', 'x')).rejects.toThrow(/YYYY-MM-DD/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe('saveAnnotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the AI grade reason with the rest of the annotation fields', async () => {
    const { saveAnnotation } = await import('./journal-actions');

    await saveAnnotation('exec-456', '2026-06-26', {
      setupNumber: 2,
      grade: 'C',
      gradeReason: 'The entry was late and management was reactive.',
      thesis: 'I expected continuation through VWAP.',
      executionNotes: 'I entered after the move extended and exited into weakness.',
      setupSuggestion: null,
    });

    expect(mocks.values).toHaveBeenCalledWith({
      firstExecId: 'exec-456',
      setupNumber: 2,
      thesis: 'I expected continuation through VWAP.',
      executionNotes: 'I entered after the move extended and exited into weakness.',
      grade: 'C',
      gradeReason: 'The entry was late and management was reactive.',
      setupSuggestion: null,
    });
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          grade: 'C',
          gradeReason: 'The entry was late and management was reactive.',
        }),
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/day/2026-06-26');
  });
});
