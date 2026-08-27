import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseFlexExecutions } from './flex-parser';

const xml = readFileSync(path.join(__dirname, '__fixtures__/flex-sample.xml'), 'utf8');

describe('parseFlexExecutions', () => {
  it('parses OPT executions and skips non-OPT/STK rows', () => {
    const execs = parseFlexExecutions(xml, { defaultTimezone: 'America/New_York' });
    expect(execs).toHaveLength(3); // CASH row skipped
  });

  it('maps fields and normalizes signed quantity from buySell', () => {
    const execs = parseFlexExecutions(xml, { defaultTimezone: 'America/New_York' });
    const buy = execs.find((e) => e.execId === '0000e1a1.01')!;
    expect(buy).toMatchObject({
      accountId: 'U1234567',
      conid: 715000001,
      underlying: 'NVDA',
      assetCategory: 'OPT',
      expiry: '2026-06-12',
      strike: 170,
      putCall: 'P',
      multiplier: 100,
      quantity: 2,
      price: 1.55,
      proceeds: -310,
      commission: -1.3,
    });
    const sell = execs.find((e) => e.execId === '0000e1a1.02')!;
    expect(sell.quantity).toBe(-2);
  });

  it('converts dateTime from statement timezone to a UTC instant', () => {
    const execs = parseFlexExecutions(xml, { defaultTimezone: 'America/New_York' });
    const buy = execs.find((e) => e.execId === '0000e1a1.01')!;
    // 2026-06-08 06:35:12 EDT == 10:35:12 UTC
    expect(buy.dateTime.toISOString()).toBe('2026-06-08T10:35:12.000Z');
  });

  it('parses expiry/BookTrade rows as zero-price executions', () => {
    const execs = parseFlexExecutions(xml, { defaultTimezone: 'America/New_York' });
    const exp = execs.find((e) => e.execId === '0000e1a1.03')!;
    expect(exp.quantity).toBe(-3);
    expect(exp.price).toBe(0);
    expect(exp.proceeds).toBe(0);
  });

  it('throws on non-Flex XML', () => {
    expect(() => parseFlexExecutions('<html></html>')).toThrow(/Flex/);
  });
});

const tcXml = readFileSync(path.join(__dirname, '__fixtures__/flex-tradeconfirm-sample.xml'), 'utf8');

describe('parseFlexExecutions — Trade Confirmation format', () => {
  it('parses TradeConfirms/TradeConfirm rows', () => {
    const execs = parseFlexExecutions(tcXml, { defaultTimezone: 'America/New_York' });
    expect(execs).toHaveLength(2);
  });

  it('maps the renamed attributes (execID, commission, price) and derives OPT + description', () => {
    const execs = parseFlexExecutions(tcXml, { defaultTimezone: 'America/New_York' });
    const buy = execs.find((e) => e.execId === '0000da50.6a3289b9.01.01')!;
    expect(buy).toMatchObject({
      accountId: 'U7654321',
      conid: 884089615,
      underlying: 'INTC',
      assetCategory: 'OPT', // derived from putCall, not present in the XML
      expiry: '2026-06-18',
      strike: 121,
      putCall: 'C',
      multiplier: 100,
      quantity: 2,
      price: 2.61, // from `price`, not `tradePrice`
      proceeds: -522,
      commission: -1.3965, // from `commission`, not `ibCommission`
    });
    // description synthesized from the OCC symbol when absent
    expect(buy.description).toContain('INTC');
    const sell = execs.find((e) => e.execId === '0000da50.6a3289c0.01.01')!;
    expect(sell.quantity).toBe(-2);
  });

  it('converts dateTime from the statement timezone to UTC', () => {
    const execs = parseFlexExecutions(tcXml, { defaultTimezone: 'America/New_York' });
    const buy = execs.find((e) => e.execId === '0000da50.6a3289b9.01.01')!;
    // 2026-06-17 10:23:27 EDT == 14:23:27 UTC
    expect(buy.dateTime.toISOString()).toBe('2026-06-17T14:23:27.000Z');
  });
});
