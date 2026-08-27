const FLEX_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

export class FlexError extends Error {}

interface FlexOptions {
  token: string;
  queryId: string;
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  rateLimitAttempts?: number;
  rateLimitDelayMs?: number;
}

/** Per-request deadline. IBKR will accept a connection and then go quiet
 * indefinitely; an undeadlined fetch turns that into a caller that never
 * settles, which upstream reads as a sync that hangs rather than one that
 * failed. Every leg gets its own deadline so a stall is always reported. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** IBKR throttles per token rather than per query, so any request that follows
 * another one closely comes back 1018 — including a button click that lands
 * near the scheduled sync, or a second click from an impatient trader. It is a
 * "come back in a moment", not a failure, and it clears on its own well inside
 * a minute; waiting it out beats making the caller re-click. The pause is
 * longer than the "still generating" poll because retrying a throttle at the
 * poll's cadence just spends more requests against the same limit. */
const RATE_LIMIT_CODE = '1018';
const DEFAULT_RATE_LIMIT_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_DELAY_MS = 5000;

export async function fetchFlexStatement(opts: FlexOptions): Promise<string> {
  const {
    token,
    queryId,
    fetchFn = fetch,
    maxAttempts = 12,
    delayMs = 5000,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    rateLimitAttempts = DEFAULT_RATE_LIMIT_ATTEMPTS,
    rateLimitDelayMs = DEFAULT_RATE_LIMIT_DELAY_MS,
  } = opts;

  const get = async (url: string) => {
    let res: Response;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new FlexError(
          `IBKR did not respond within ${Math.round(timeoutMs / 1000)}s — try again in a minute.`,
        );
      }
      throw err;
    }
    return res.text();
  };

  /** A request that treats a throttle as a pause rather than an outcome. */
  const request = async (url: string): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      const xml = await get(url);
      if (tagValue(xml, 'ErrorCode') !== RATE_LIMIT_CODE) return xml;
      if (attempt >= rateLimitAttempts) {
        throw new FlexError(
          'IBKR is rate-limiting this token — a sync ran moments ago. Wait a minute and try again.',
        );
      }
      await sleep(rateLimitDelayMs);
    }
  };

  const sendXml = await request(`${FLEX_BASE}/SendRequest?t=${token}&q=${queryId}&v=3`);
  const ref = tagValue(sendXml, 'ReferenceCode');
  if (!ref) throw new FlexError(tagValue(sendXml, 'ErrorMessage') ?? 'Flex SendRequest failed');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const xml = await request(`${FLEX_BASE}/GetStatement?t=${token}&q=${ref}&v=3`);
    if (xml.includes('<FlexQueryResponse')) return xml;
    const code = tagValue(xml, 'ErrorCode');
    if (code === '1019' || code === '1021') {
      if (attempt < maxAttempts - 1) await sleep(delayMs);
      continue;
    }
    throw new FlexError(tagValue(xml, 'ErrorMessage') ?? `Flex error ${code ?? 'unknown'}`);
  }
  throw new FlexError(`Flex statement not ready after ${maxAttempts} attempts`);
}

function tagValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
