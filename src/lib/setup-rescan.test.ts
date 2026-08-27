import { describe, expect, it } from 'vitest';
import { buildRescanTranscript, shouldScanUntaggedTrade } from './setup-rescan';

describe('buildRescanTranscript', () => {
  it('includes thesis and execution notes for an annotated untagged trade', () => {
    const transcript = buildRescanTranscript({
      thesis: 'PLTR had been in a downtrend for several days.',
      executionNotes: 'I shorted continuation after a weekly level failed.',
    });

    expect(transcript).toContain('PLTR had been in a downtrend');
    expect(transcript).toContain('I shorted continuation');
  });

  it('trims blank sections', () => {
    const transcript = buildRescanTranscript({
      thesis: '  ',
      executionNotes: 'Managed with a tight stop.',
    });

    expect(transcript).toBe('Execution notes:\nManaged with a tight stop.');
  });
});

describe('shouldScanUntaggedTrade', () => {
  it('scans trades with notes and no setup', () => {
    expect(shouldScanUntaggedTrade({ setupNumber: null, thesis: 'x', executionNotes: null })).toBe(true);
    expect(shouldScanUntaggedTrade({ setupNumber: null, thesis: null, executionNotes: 'x' })).toBe(true);
  });

  it('skips trades that are already tagged or have no notes', () => {
    expect(shouldScanUntaggedTrade({ setupNumber: 1, thesis: 'x', executionNotes: 'x' })).toBe(false);
    expect(shouldScanUntaggedTrade({ setupNumber: null, thesis: ' ', executionNotes: null })).toBe(false);
  });
});
