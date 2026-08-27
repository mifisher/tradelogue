import { describe, it, expect, vi } from 'vitest';
import { retryTransient } from './coach';
import { AiProviderError, AiTruncatedError } from './provider';

/** No real waiting in tests; also lets us assert the backoff grows. */
const recordSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); } };
};

describe('retryTransient', () => {
  it('returns the first success without sleeping', async () => {
    const { waits, sleep } = recordSleep();
    const call = vi.fn().mockResolvedValue('ok');
    expect(await retryTransient(call, { sleep })).toBe('ok');
    expect(call).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('recovers from a transient schema slip on the next attempt', async () => {
    const { sleep } = recordSleep();
    const call = vi.fn()
      .mockRejectedValueOnce(new Error('did not match the expected schema (whatWorked: expected array)'))
      .mockResolvedValueOnce('ok');
    expect(await retryTransient(call, { sleep })).toBe('ok');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('retries a free-tier rate limit rather than surfacing it', async () => {
    const { sleep } = recordSleep();
    const call = vi.fn()
      .mockRejectedValueOnce(new AiProviderError('Rate limited', 429, 'rate_limit'))
      .mockResolvedValueOnce('ok');
    expect(await retryTransient(call, { sleep })).toBe('ok');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('backs off further on each successive attempt', async () => {
    const { waits, sleep } = recordSleep();
    const call = vi.fn().mockRejectedValue(new Error('empty completion'));
    await expect(
      retryTransient(call, { sleep, attempts: 3, baseDelayMs: 100 }),
    ).rejects.toThrow('empty completion');
    expect(call).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([100, 200]);
  });

  it('gives up with the last error after exhausting attempts', async () => {
    const { sleep } = recordSleep();
    const call = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'));
    await expect(retryTransient(call, { sleep, attempts: 3 })).rejects.toThrow('third');
  });

  // A bad key never fixes itself, and retrying only delays telling the trader.
  it('surfaces an authentication error immediately', async () => {
    const { sleep } = recordSleep();
    const call = vi.fn().mockRejectedValue(new AiProviderError('Bad key', 401, 'auth'));
    await expect(retryTransient(call, { sleep })).rejects.toThrow('Bad key');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('honours a custom attempt count', async () => {
    const { sleep } = recordSleep();
    const call = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(retryTransient(call, { sleep, attempts: 5 })).rejects.toThrow('nope');
    expect(call).toHaveBeenCalledTimes(5);
  });

  // A throttled model (stealth/ox-alpha returns 429 in under a second, with no
  // Retry-After header) outruns linear backoff: three attempts spent ~4.5s and
  // gave up while the throttle was still closed. Growth has to be exponential.
  it('grows the backoff exponentially, not linearly', async () => {
    const { waits, sleep } = recordSleep();
    const call = vi.fn().mockRejectedValue(new Error('empty completion'));
    await expect(
      retryTransient(call, { sleep, attempts: 4, baseDelayMs: 100 }),
    ).rejects.toThrow('empty completion');
    expect(waits).toEqual([100, 200, 400]);
  });

  it('caps the backoff so a long tail cannot stall the run', async () => {
    const { waits, sleep } = recordSleep();
    const call = vi.fn().mockRejectedValue(new Error('empty completion'));
    await expect(
      retryTransient(call, { sleep, attempts: 5, baseDelayMs: 1000, maxDelayMs: 2500 }),
    ).rejects.toThrow('empty completion');
    expect(waits).toEqual([1000, 2000, 2500, 2500]);
  });

  // A blown token budget is deterministic: the same prompt reasons past the same
  // cap every time. Retrying it burned 5 attempts x ~175s and turned a 3-minute
  // failure into a 28-minute one.
  it('gives up immediately on a truncated response', async () => {
    const { waits, sleep } = recordSleep();
    const call = vi.fn().mockRejectedValue(new AiTruncatedError('hit the 8000-token cap'));
    await expect(retryTransient(call, { sleep })).rejects.toThrow('hit the 8000-token cap');
    expect(call).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  // OpenRouter sends no Retry-After on its 429s, but other providers do, and
  // obeying it beats guessing when it is there.
  it('waits at least as long as a Retry-After hint on the error', async () => {
    const { waits, sleep } = recordSleep();
    const err = new AiProviderError('Rate limited', 429, 'rate_limit', 5000);
    const call = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    expect(await retryTransient(call, { sleep, baseDelayMs: 100 })).toBe('ok');
    expect(waits).toEqual([5000]);
  });
});
