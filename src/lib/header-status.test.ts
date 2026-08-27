import { describe, it, expect } from 'vitest';
import { headerStatus } from './header-status';

// 2026-07-30 15:03 UTC = 11:03 AM EDT, so the session date is the 30th.
const NOW = new Date('2026-07-30T15:03:00.000Z');

describe('headerStatus', () => {
  it('labels the trading session, matching what the cards filter on', () => {
    expect(headerStatus(NOW, null).dateLabel).toBe('Thu, Jul 30 · EDT');
  });

  it('reports the generation time in the trading timezone when the brief is today\'s', () => {
    const status = headerStatus(NOW, {
      briefDate: '2026-07-30',
      generatedAt: new Date('2026-07-30T15:03:00.000Z'),
      status: 'ok',
    });
    expect(status).toMatchObject({ state: 'fresh', updatedLabel: 'Updated 11:03 AM' });
  });

  it('calls out a brief left over from an earlier session', () => {
    const status = headerStatus(NOW, {
      briefDate: '2026-07-29',
      generatedAt: new Date('2026-07-29T12:00:00.000Z'),
      status: 'ok',
    });
    expect(status).toMatchObject({ state: 'stale', updatedLabel: 'Brief from Jul 29' });
  });

  it('says so plainly when no brief has ever run', () => {
    expect(headerStatus(NOW, null)).toMatchObject({ state: 'none', updatedLabel: 'No brief yet' });
  });

  // A brief generated early in the local morning can be stamped a different
  // UTC day; keying off the session date rather than UTC keeps it reading fresh.
  it('treats an early-morning run as today, not yesterday', () => {
    const earlyRun = new Date('2026-07-30T12:00:00.000Z'); // 8:00 AM EDT
    const status = headerStatus(earlyRun, {
      briefDate: '2026-07-30',
      generatedAt: earlyRun,
      status: 'ok',
    });
    expect(status).toMatchObject({ state: 'fresh', updatedLabel: 'Updated 8:00 AM' });
  });

  it('does not slide the date across a zone offset', () => {
    // 2026-07-30 07:30 UTC is still 3:30 AM EDT on the 30th.
    expect(headerStatus(new Date('2026-07-30T07:30:00.000Z'), null).dateLabel).toBe('Thu, Jul 30 · EDT');
    // …and 03:30 UTC is 11:30 PM EDT on the 29th.
    expect(headerStatus(new Date('2026-07-30T03:30:00.000Z'), null).dateLabel).toBe('Wed, Jul 29 · EDT');
  });
});
