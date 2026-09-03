import type { SetupArea, SetupState } from './state';

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 20_000;

/** Wait for the server to come back carrying the value that was just saved.
 *
 * Writing .env makes the Next dev server restart, so process.env is only
 * updated on the far side of that restart. Fetches fail outright while the
 * server is down; that is expected and is not an error worth showing.
 *
 * Resolves false on timeout, which is the `next start` case — there is no
 * watcher there, so the user has to restart by hand. */
export async function waitForSetupArea(
  area: SetupArea,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/setup/status', { cache: 'no-store' });
      if (res.ok) {
        const state = (await res.json()) as SetupState;
        if (state[area]) return true;
      }
    } catch {
      // Server is mid-restart. Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
