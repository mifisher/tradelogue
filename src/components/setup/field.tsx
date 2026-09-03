'use client';

import { useState, useTransition } from 'react';
import type { TestResult } from '@/lib/setup/test-result';

// Matches the input styling already used by RulesManager.
export const INPUT_CLS =
  'bg-deep border border-hairline rounded-[12px] px-4 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone';
export const LABEL_CLS = 'text-[13px] uppercase tracking-wide text-stone mb-1 block';

export function Section({
  title,
  blurb,
  done,
  children,
}: {
  title: string;
  blurb?: React.ReactNode;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-elevated rounded-[20px] p-8">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="font-display text-xl text-ondark">{title}</h2>
        {done !== undefined && (
          <span
            className={`w-2 h-2 rounded-full ${done ? 'bg-gain' : 'bg-stone'}`}
            aria-label={done ? 'configured' : 'not configured'}
          />
        )}
      </div>
      {blurb && <div className="text-sm text-mute mb-6 leading-relaxed">{blurb}</div>}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  help,
  placeholder,
  secret,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: React.ReactNode;
  placeholder?: string;
  secret?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <div className="relative">
        <input
          className={INPUT_CLS}
          type={secret && !reveal ? 'password' : 'text'}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-stone hover:text-ondark"
          >
            {reveal ? 'hide' : 'show'}
          </button>
        )}
      </div>
      {help && <div className="text-[13px] text-stone mt-1.5 leading-relaxed">{help}</div>}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  help?: React.ReactNode;
}) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <select className={INPUT_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <div className="text-[13px] text-stone mt-1.5 leading-relaxed">{help}</div>}
    </div>
  );
}

/** Generic in the result type so a test that returns more than TestResult —
 * testDatabase also reports whether the schema exists — keeps that field when
 * it reaches onResult. */
export function TestButton<T extends TestResult>({
  label,
  run,
  onResult,
}: {
  label: string;
  run: () => Promise<T>;
  onResult?: (result: T) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<T | null>(null);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const next = await run();
            setResult(next);
            onResult?.(next);
          })
        }
        className="h-10 rounded-full border border-hairline px-5 text-sm font-semibold text-ondark disabled:opacity-50"
      >
        {pending ? 'Checking…' : label}
      </button>
      {result && (
        <span className={`text-[13px] ${result.ok ? 'text-gain' : 'text-loss'}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}

export function SaveBar({
  onSave,
  saving,
  message,
  fallback,
}: {
  onSave: () => void;
  saving: boolean;
  message: string | null;
  /** Lines to paste into .env by hand, shown only when writing the file failed. */
  fallback?: string | null;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="h-11 rounded-full bg-ondark px-6 font-semibold text-canvas disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-[13px] text-mute">{message}</span>}
      </div>
      {fallback && (
        <div className="space-y-2">
          <p className="text-[13px] text-stone">
            Could not write the file. Add these lines to{' '}
            <code className="bg-deep rounded px-1.5 py-0.5 text-ondark">.env</code> yourself:
          </p>
          <pre className="rounded-[12px] bg-deep p-4 text-[12px] text-mute overflow-x-auto">
            {fallback}
          </pre>
        </div>
      )}
    </div>
  );
}
