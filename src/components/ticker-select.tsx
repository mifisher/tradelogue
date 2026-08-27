'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface TickerSelectProps {
  tickers: string[];
  current: string;
}

export function TickerSelect({ tickers, current }: TickerSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set('ticker', e.target.value);
    } else {
      params.delete('ticker');
    }
    router.push(`/trades?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={handleChange}
      className="bg-elevated rounded-full px-4 h-9 text-sm text-ondark border border-hairline cursor-pointer"
    >
      <option value="">All tickers</option>
      {tickers.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
