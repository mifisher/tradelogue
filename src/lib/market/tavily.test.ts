import { describe, it, expect, vi } from 'vitest';
import { tavilySearch, TavilyError } from './tavily';

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const BODY = {
  results: [
    { title: 'Chip selloff', url: 'https://wsj.com/a', content: 'Semis drag futures…', published_date: '2026-07-20' },
    { title: 'No date', url: 'https://x.com/b', content: 'Body' },
  ],
};

describe('tavilySearch', () => {
  it('POSTs the query with bearer auth and maps results', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonRes(200, BODY));
    const results = await tavilySearch('market news', {
      apiKey: 'tk', fetchFn, maxResults: 5, topic: 'news', days: 2, includeDomains: ['wsj.com'],
    });
    expect(results).toEqual([
      { title: 'Chip selloff', url: 'https://wsj.com/a', content: 'Semis drag futures…', publishedDate: '2026-07-20' },
      { title: 'No date', url: 'https://x.com/b', content: 'Body', publishedDate: null },
    ]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe('https://api.tavily.com/search');
    expect(init.headers.Authorization).toBe('Bearer tk');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ query: 'market news', max_results: 5, topic: 'news', days: 2, include_domains: ['wsj.com'] });
  });

  it('throws TavilyError with status on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(401, { detail: 'bad key' }));
    await expect(tavilySearch('q', { apiKey: 'bad', fetchFn })).rejects.toThrow(TavilyError);
  });
});
