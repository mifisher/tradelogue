'use client';
import { useState } from 'react';

export default function ImportPage() {
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/import', { method: 'POST', body: new FormData(e.currentTarget) });
      setResult(JSON.stringify(await res.json(), null, 2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <h1 className="font-display text-2xl mb-6">Import IBKR Flex XML</h1>
      <form onSubmit={onSubmit} className="bg-elevated rounded-[20px] p-8 space-y-6">
        <input
          type="file"
          name="file"
          accept=".xml,text/xml"
          required
          className="block w-full text-sm text-mute file:mr-4 file:rounded-full file:border-0 file:bg-deep file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ondark"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-12 rounded-full bg-ondark px-7 font-semibold text-canvas disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </form>
      {result && (
        <pre className="mt-6 rounded-[12px] bg-deep p-4 text-sm text-mute overflow-x-auto">
          {result}
        </pre>
      )}
    </main>
  );
}
