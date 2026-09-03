'use client';

import { Section, Field, TestButton, SaveBar } from './field';
import { useSectionForm } from './use-section-form';
import { testTavily, testFinnhub } from '@/lib/setup/actions';

export function MarketSection({
  initial,
  masked,
  done,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  done: boolean;
}) {
  const { values, set, save, saving, message, fallback } = useSectionForm({ initial, masked, area: 'market' });

  const tavily = values.TAVILY_API_KEY ?? '';
  const finnhub = values.FINNHUB_API_KEY ?? '';

  return (
    <Section
      title="Market data"
      done={done}
      blurb="Optional — needed only for the premarket brief. The free tier of each is enough for one brief a day. Index sparklines come from keyless FRED data, so there is nothing to configure for those."
    >
      <Field
        label="Tavily API key"
        value={tavily}
        onChange={(v) => set('TAVILY_API_KEY', v)}
        secret
        help={
          <>
            News and Reddit search. Get one at{' '}
            <a href="https://app.tavily.com" target="_blank" rel="noreferrer" className="text-cobalt underline underline-offset-2">
              app.tavily.com
            </a>
            .
          </>
        }
      />
      <TestButton label="Test Tavily" run={() => testTavily(tavily)} />

      <Field
        label="Finnhub API key"
        value={finnhub}
        onChange={(v) => set('FINNHUB_API_KEY', v)}
        secret
        help={
          <>
            Quotes and the earnings calendar. Get one at{' '}
            <a href="https://finnhub.io/dashboard" target="_blank" rel="noreferrer" className="text-cobalt underline underline-offset-2">
              finnhub.io/dashboard
            </a>
            .
          </>
        }
      />
      <TestButton label="Test Finnhub" run={() => testFinnhub(finnhub)} />

      <SaveBar onSave={save} saving={saving} message={message} fallback={fallback} />
    </Section>
  );
}
