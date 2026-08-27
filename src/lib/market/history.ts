export interface DailyClose {
  date: string;
  close: number;
}

interface Opts {
  fetchFn?: typeof fetch;
  limit?: number;
}

/** Parse a CSV whose first column is a YYYY-MM-DD date and `closeCol` is the
 * close; skips the header and non-numeric ('.') rows. */
function parseCloses(csv: string, closeCol: number, limit: number): DailyClose[] {
  const rows: DailyClose[] = [];
  for (const line of csv.trim().split('\n').slice(1)) {
    const cells = line.split(',');
    const date = cells[0]?.trim();
    const close = Number(cells[closeCol]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(close)) continue;
    rows.push({ date: date!, close });
  }
  return rows.slice(-limit);
}

/** Daily closes from FRED's keyless fredgraph.csv for any series id.
 * Sparkline source for the index cards (SP500 / NASDAQ100 / VIXCLS) since
 * Finnhub's free tier gates /stock/candle and Stooq now bot-walls CSV
 * requests behind a JavaScript proof-of-work challenge. */
export async function fetchFredCloses(seriesId: string, opts: Opts = {}): Promise<DailyClose[]> {
  const { fetchFn = fetch, limit = 30 } = opts;
  const res = await fetchFn(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`);
  if (!res.ok) throw new Error(`FRED ${seriesId} failed (${res.status})`);
  return parseCloses(await res.text(), 1, limit);
}

/** VIX daily closes (FRED VIXCLS series). */
export async function fetchVixCloses(opts: Opts = {}): Promise<DailyClose[]> {
  return fetchFredCloses('VIXCLS', opts);
}
