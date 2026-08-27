export class TavilyError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
}

interface TavilyOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  maxResults?: number;
  topic?: 'news' | 'general';
  days?: number;
  includeDomains?: string[];
}

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

export async function tavilySearch(query: string, opts: TavilyOptions): Promise<TavilyResult[]> {
  const { apiKey, fetchFn = fetch, maxResults = 6, topic = 'general', days, includeDomains } = opts;
  const res = await fetchFn('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      topic,
      ...(days !== undefined ? { days } : {}),
      ...(includeDomains ? { include_domains: includeDomains } : {}),
    }),
  });
  if (!res.ok) {
    throw new TavilyError(`Tavily search failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as { results?: TavilyRawResult[] };
  return (body.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    publishedDate: r.published_date ?? null,
  }));
}
