import { describe, it, expect, vi } from 'vitest';
import { fetchFlexStatement, FlexError } from './flex-client';

function res(body: string) {
  return { text: async () => body } as Response;
}

/** A server that accepts the connection and then says nothing, ever. Settles
 * only if the caller supplies an abort signal and that signal fires. */
function stalledFetch(): typeof fetch {
  return ((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as typeof fetch;
}

const SEND_OK = '<FlexStatementResponse><Status>Success</Status><ReferenceCode>123456</ReferenceCode></FlexStatementResponse>';
const IN_PROGRESS = '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress.</ErrorMessage></FlexStatementResponse>';
const STATEMENT = '<FlexQueryResponse queryName="x" type="AF"></FlexQueryResponse>';
const SEND_FAIL = '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage></FlexStatementResponse>';
const RATE_LIMITED = '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1018</ErrorCode><ErrorMessage>Too many requests have been made from this token. Please try again shortly.</ErrorMessage></FlexStatementResponse>';

describe('fetchFlexStatement', () => {
  it('requests a reference code then fetches the statement', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(SEND_OK))
      .mockResolvedValueOnce(res(STATEMENT));
    const xml = await fetchFlexStatement({ token: 't', queryId: 'q', fetchFn, delayMs: 1 });
    expect(xml).toBe(STATEMENT);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[0][0])).toContain('SendRequest?t=t&q=q&v=3');
    expect(String(fetchFn.mock.calls[1][0])).toContain('GetStatement?t=t&q=123456&v=3');
  });

  it('retries while generation is in progress', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(SEND_OK))
      .mockResolvedValueOnce(res(IN_PROGRESS))
      .mockResolvedValueOnce(res(STATEMENT));
    const xml = await fetchFlexStatement({ token: 't', queryId: 'q', fetchFn, delayMs: 1 });
    expect(xml).toBe(STATEMENT);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws FlexError with IBKR message on failure', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(res(SEND_FAIL));
    await expect(fetchFlexStatement({ token: 't', queryId: 'q', fetchFn })).rejects.toThrow(FlexError);
    await expect(fetchFlexStatement({ token: 't', queryId: 'q', fetchFn: vi.fn().mockResolvedValueOnce(res(SEND_FAIL)) })).rejects.toThrow('Token has expired.');
  });

  it('gives up when IBKR accepts the connection but never responds', async () => {
    // The failure behind a "Sync from IBKR" button stuck on "Syncing…" forever:
    // IBKR takes the connection and then goes quiet. Without a deadline the
    // fetch never settles, the server action never returns, and the client has
    // nothing to render — not success, not an error.
    await expect(
      fetchFlexStatement({ token: 't', queryId: 'q', fetchFn: stalledFetch(), timeoutMs: 20 }),
    ).rejects.toThrow(FlexError);
  });

  it('gives up if a poll stalls after the reference code arrives', async () => {
    const stalled = stalledFetch();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res(SEND_OK))
      .mockImplementation(stalled) as unknown as typeof fetch;
    await expect(
      fetchFlexStatement({ token: 't', queryId: 'q', fetchFn, timeoutMs: 20, delayMs: 1 }),
    ).rejects.toThrow(/did not respond/i);
  });

  it('waits out a rate limit on the initial request', async () => {
    // IBKR throttles per token, not per query, so a click that lands just
    // after the scheduled sync gets 1018 before any work starts.
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(RATE_LIMITED))
      .mockResolvedValueOnce(res(SEND_OK))
      .mockResolvedValueOnce(res(STATEMENT));
    const xml = await fetchFlexStatement({
      token: 't', queryId: 'q', fetchFn, delayMs: 1, rateLimitDelayMs: 1,
    });
    expect(xml).toBe(STATEMENT);
  });

  it('waits out a rate limit that arrives mid-poll', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(SEND_OK))
      .mockResolvedValueOnce(res(RATE_LIMITED))
      .mockResolvedValueOnce(res(STATEMENT));
    const xml = await fetchFlexStatement({
      token: 't', queryId: 'q', fetchFn, delayMs: 1, rateLimitDelayMs: 1,
    });
    expect(xml).toBe(STATEMENT);
  });

  it('explains the rate limit in its own words when it will not clear', async () => {
    // IBKR's own wording ("try again shortly") says nothing about which token
    // or why, and the caller has no way to tell it apart from a real failure.
    const fetchFn = vi.fn().mockResolvedValue(res(RATE_LIMITED));
    await expect(
      fetchFlexStatement({
        token: 't', queryId: 'q', fetchFn, rateLimitDelayMs: 1, rateLimitAttempts: 3,
      }),
    ).rejects.toThrow(/rate-limiting this token/i);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws after maxAttempts when generation never completes', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(SEND_OK))
      .mockResolvedValue(res(IN_PROGRESS));
    await expect(
      fetchFlexStatement({ token: 't', queryId: 'q', fetchFn, maxAttempts: 2, delayMs: 1 }),
    ).rejects.toThrow('not ready after 2 attempts');
    expect(fetchFn).toHaveBeenCalledTimes(3); // 1 SendRequest + 2 GetStatement polls
  });
});
