import { describe, it, expect } from 'vitest';
import { executionToRow, rowToExecution } from './row-mapping';
import type { Execution } from './types';

const exec: Execution = {
  execId: 'e1', accountId: 'U1', conid: 100, underlying: 'NVDA',
  description: 'NVDA 12JUN26 170.0 P', assetCategory: 'OPT',
  expiry: '2026-06-12', strike: 170, putCall: 'P', multiplier: 100,
  dateTime: new Date('2026-06-08T13:35:00Z'),
  quantity: 2, price: 1.55, proceeds: -310, commission: -1.3, raw: { a: 1 },
};

describe('row mapping', () => {
  it('round-trips an execution through row shape unchanged', () => {
    expect(rowToExecution(executionToRow(exec))).toEqual(exec);
  });
});
