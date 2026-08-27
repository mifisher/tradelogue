/** Pull likely ticker symbols out of news prose so their real quotes can be put
 * in front of the model before it picks stocksInPlay. Precision matters less
 * than it looks: every candidate is verified against Finnhub afterwards, and an
 * unknown symbol simply yields no quote. The stopword list exists to stop us
 * spending API calls on "AI" and "FOMC", not to be the real filter. */

/** All-caps words that read as tickers but never are, in this corpus. Some are
 * genuinely listed (AI is C3.ai, DD is DuPont) but in market prose they mean
 * the acronym far more often than the company. */
const STOPWORDS = new Set([
  'A', 'I', 'AI', 'AM', 'PM', 'ET', 'PT', 'EST', 'EDT', 'PST', 'PDT', 'UTC', 'GMT',
  'US', 'USA', 'UK', 'EU', 'ECB', 'BOJ', 'BOE', 'FED', 'FOMC', 'SEC', 'FDA', 'FTC', 'DOJ', 'IRS',
  'GDP', 'CPI', 'PCE', 'PPI', 'PMI', 'ISM', 'ADP', 'JOLTS', 'NFP', 'HPI',
  'CEO', 'CFO', 'COO', 'CTO', 'CIO', 'IPO', 'MA', 'LBO', 'SPAC',
  'ETF', 'ETFS', 'NYSE', 'AMEX', 'OTC', 'SPX', 'NDX', 'DJIA', 'DOW',
  'EPS', 'PE', 'PEG', 'ROE', 'ROI', 'EBIT', 'FCF', 'YOY', 'QOQ', 'MOM', 'YTD', 'MTD', 'TTM',
  'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY', 'CY',
  'RSI', 'VWAP', 'EMA', 'SMA', 'MACD', 'ATR', 'ATH', 'OTM', 'ITM', 'IV',
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'CHF',
  'CNBC', 'CNN', 'BBC', 'WSJ', 'FT', 'AP', 'PR', 'TV',
  'THE', 'AND', 'FOR', 'NOT', 'NEW', 'ALL', 'BUT', 'OUT', 'NOW', 'ONE', 'TWO', 'TOP', 'CEOS',
  'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'IF', 'IN', 'IS', 'IT', 'ME', 'MY',
  'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'WE', 'OK',
  'LLC', 'INC', 'CORP', 'LTD', 'PLC', 'CO', 'HQ', 'API', 'HTTP', 'HTTPS', 'URL',
  'WSB', 'DD', 'YOLO', 'HODL', 'FUD',
]);

/** An exchange prefix, a cashtag, or a name-trailing parenthesis is someone
 * deliberately writing a ticker, so those outweigh a bare capitalised word. */
const STRONG_FORMS = [
  /\b(?:NASDAQ|NYSE|NYSEARCA|NYSE\s+American|AMEX|OTC|CBOE)\s*:\s*([A-Z]{1,5})\b/g,
  /\$([A-Z]{1,5})\b/g,
  /\(([A-Z]{1,5})\)/g,
];
const BARE_FORM = /\b([A-Z]{1,5})\b/g;

const STRONG_WEIGHT = 3;

export interface ScanOptions {
  /** Maximum symbols returned; each one costs a quote lookup downstream. */
  limit?: number;
}

/** Candidate tickers, most likely first. Ranking is by weighted mention count
 * — a name written three different ways across three articles is the day's
 * story — with ties broken alphabetically so a run is reproducible. */
export function scanTickers(texts: string[], opts: ScanOptions = {}): string[] {
  const { limit = 12 } = opts;
  const scores = new Map<string, number>();

  const add = (symbol: string, weight: number) => {
    if (STOPWORDS.has(symbol)) return;
    scores.set(symbol, (scores.get(symbol) ?? 0) + weight);
  };

  for (const text of texts) {
    if (!text) continue;
    for (const pattern of STRONG_FORMS) {
      for (const match of text.matchAll(pattern)) add(match[1], STRONG_WEIGHT);
    }
    for (const match of text.matchAll(BARE_FORM)) add(match[1], 1);
  }

  return [...scores.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([symbol]) => symbol);
}
