import { describe, it, expect, vi } from 'vitest';
import { fetchFredCloses, fetchVixCloses } from './history';

function textRes(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

const SP500_CSV = `observation_date,SP500
2026-07-16,7533.77
2026-07-17,.
2026-07-20,7475.80`;

const VIX_CSV = `observation_date,VIXCLS
2026-07-16,16.90
2026-07-17,18.10
2026-07-18,.
2026-07-20,18.22`;

describe('fetchFredCloses', () => {
  it('parses closes oldest→newest and skips missing ("." ) observations', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(textRes(200, SP500_CSV));
    const closes = await fetchFredCloses('SP500', { fetchFn });
    expect(closes).toEqual([
      { date: '2026-07-16', close: 7533.77 },
      { date: '2026-07-20', close: 7475.8 },
    ]);
    expect(String(fetchFn.mock.calls[0][0])).toContain('fredgraph.csv?id=SP500');
  });

  it('honors limit (keeps the most recent rows)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(textRes(200, SP500_CSV));
    const closes = await fetchFredCloses('SP500', { fetchFn, limit: 1 });
    expect(closes.map((c) => c.date)).toEqual(['2026-07-20']);
  });

  it('throws on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(textRes(500, ''));
    await expect(fetchFredCloses('SP500', { fetchFn })).rejects.toThrow('FRED SP500 failed (500)');
  });
});

describe('fetchVixCloses', () => {
  it('parses the VIXCLS series and skips missing ("." ) observations', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(textRes(200, VIX_CSV));
    const closes = await fetchVixCloses({ fetchFn });
    expect(closes).toEqual([
      { date: '2026-07-16', close: 16.9 },
      { date: '2026-07-17', close: 18.1 },
      { date: '2026-07-20', close: 18.22 },
    ]);
    expect(String(fetchFn.mock.calls[0][0])).toContain('fredgraph.csv?id=VIXCLS');
  });
});
