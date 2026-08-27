import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtMoneyWhole, fmtPct, fmtHold } from './format';

describe('fmtMoney', () => {
  it('formats negative values with minus sign', () => {
    expect(fmtMoney(-1234.5)).toBe('-$1,234.50');
  });
  it('formats positive values with plus sign', () => {
    expect(fmtMoney(97.4)).toBe('+$97.40');
  });
  it('formats zero without sign', () => {
    expect(fmtMoney(0)).toBe('$0.00');
  });
});

describe('fmtMoneyWhole', () => {
  it('rounds to whole dollars for compact display', () => {
    expect(fmtMoneyWhole(-1619.55)).toBe('-$1,620');
    expect(fmtMoneyWhole(1324.98)).toBe('+$1,325');
    expect(fmtMoneyWhole(-30.25)).toBe('-$30');
    expect(fmtMoneyWhole(0)).toBe('$0');
  });
  it('never rounds a small loss to a signed zero', () => {
    expect(fmtMoneyWhole(-0.4)).toBe('-$0');
    expect(fmtMoneyWhole(0.4)).toBe('+$0');
  });
});

describe('fmtPct', () => {
  it('formats decimal ratio to one decimal percent', () => {
    expect(fmtPct(0.553)).toBe('55.3%');
  });
});

describe('fmtHold', () => {
  it('formats milliseconds to minutes only', () => {
    expect(fmtHold(2_100_000)).toBe('35m');
  });
  it('formats milliseconds to hours and minutes', () => {
    expect(fmtHold(95 * 60_000)).toBe('1h 35m');
  });
  it('formats milliseconds to seconds only', () => {
    expect(fmtHold(45_000)).toBe('45s');
  });
});
