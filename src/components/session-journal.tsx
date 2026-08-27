'use client';

import { useState, useTransition } from 'react';
import { saveSession } from '@/lib/journal-actions';
import { useUnsavedWarning } from '@/lib/use-unsaved-warning';

interface SessionJournalProps {
  sessionDate: string;
  initial: {
    sentiment?: string | null;
    mood?: string | null;
    sleepScore?: number | null;
    sleepMinutes?: number | null;
    marketContext?: string | null;
    recap?: string | null;
  } | null;
}

const INPUT_CLS =
  'bg-deep border border-hairline rounded-[12px] px-4 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone';
const LABEL_CLS = 'text-[13px] uppercase tracking-wide text-stone mb-1 block';

function minutesToHM(minutes: number | null | undefined): { h: string; m: string } {
  if (minutes == null) return { h: '', m: '' };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { h: String(h), m: String(m) };
}

function serialize(
  sentiment: string,
  sleepScore: string,
  sleepH: string,
  sleepM: string,
  mood: string,
  marketContext: string,
  recap: string,
): string {
  return [sentiment, sleepScore, sleepH, sleepM, mood, marketContext, recap].join('\x00');
}

export function SessionJournal({ sessionDate, initial }: SessionJournalProps) {
  const [sentiment, setSentiment] = useState(initial?.sentiment ?? '');
  const [sleepScore, setSleepScore] = useState(
    initial?.sleepScore != null ? String(initial.sleepScore) : '',
  );
  const { h: initH, m: initM } = minutesToHM(initial?.sleepMinutes);
  const [sleepH, setSleepH] = useState(initH);
  const [sleepM, setSleepM] = useState(initM);
  const [mood, setMood] = useState(initial?.mood ?? '');
  const [marketContext, setMarketContext] = useState(initial?.marketContext ?? '');
  const [recap, setRecap] = useState(initial?.recap ?? '');

  const [baseline, setBaseline] = useState(() =>
    serialize(
      initial?.sentiment ?? '',
      initial?.sleepScore != null ? String(initial.sleepScore) : '',
      initH,
      initM,
      initial?.mood ?? '',
      initial?.marketContext ?? '',
      initial?.recap ?? '',
    ),
  );

  const isDirty = serialize(sentiment, sleepScore, sleepH, sleepM, mood, marketContext, recap) !== baseline;
  useUnsavedWarning(isDirty, `session:${sessionDate}`);

  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const sleepMinutes =
      sleepH !== '' || sleepM !== ''
        ? (parseInt(sleepH || '0', 10) * 60 + parseInt(sleepM || '0', 10))
        : null;

    startTransition(async () => {
      await saveSession(sessionDate, {
        sentiment: sentiment || null,
        mood: mood || null,
        sleepScore: sleepScore !== '' ? parseInt(sleepScore, 10) : null,
        sleepMinutes,
        marketContext: marketContext || null,
        recap: recap || null,
      });
      setBaseline(serialize(sentiment, sleepScore, sleepH, sleepM, mood, marketContext, recap));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          {/* Sentiment */}
          <div>
            <label className={LABEL_CLS}>Sentiment</label>
            <select
              value={sentiment}
              onChange={(e) => setSentiment(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">—</option>
              <option value="Bullish">Bullish</option>
              <option value="Upbeat">Upbeat</option>
              <option value="Bearish">Bearish</option>
              <option value="Uncertain">Uncertain</option>
            </select>
          </div>

          {/* Sleep */}
          <div>
            <label className={LABEL_CLS}>Sleep score (0–100)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={sleepScore}
              onChange={(e) => setSleepScore(e.target.value)}
              placeholder="—"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Sleep duration</label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min={0}
                max={23}
                value={sleepH}
                onChange={(e) => setSleepH(e.target.value)}
                placeholder="h"
                className="bg-deep border border-hairline rounded-[12px] px-3 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone"
              />
              <span className="text-stone text-sm shrink-0">h</span>
              <input
                type="number"
                min={0}
                max={59}
                value={sleepM}
                onChange={(e) => setSleepM(e.target.value)}
                placeholder="m"
                className="bg-deep border border-hairline rounded-[12px] px-3 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone"
              />
              <span className="text-stone text-sm shrink-0">m</span>
            </div>
          </div>

          {/* Mood */}
          <div>
            <label className={LABEL_CLS}>Mood</label>
            <textarea
              rows={2}
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              placeholder="How are you feeling today?"
              className={INPUT_CLS + ' resize-none'}
            />
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* Market context */}
          <div>
            <label className={LABEL_CLS}>Market context</label>
            <textarea
              rows={4}
              value={marketContext}
              onChange={(e) => setMarketContext(e.target.value)}
              placeholder="Key macro events, sector themes, overall tape…"
              className={INPUT_CLS + ' resize-none'}
            />
          </div>

          {/* Recap */}
          <div>
            <label className={LABEL_CLS}>Recap</label>
            <textarea
              rows={4}
              value={recap}
              onChange={(e) => setRecap(e.target.value)}
              placeholder="Session summary, key observations, what went well / poorly…"
              className={INPUT_CLS + ' resize-none'}
            />
          </div>
        </div>
      </div>

      {/* Save row */}
      <div className="flex items-center gap-4 mt-5">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-full bg-ondark text-canvas px-6 h-10 font-semibold text-sm disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && (
          <span className="text-sm text-gain">Saved ✓</span>
        )}
      </div>
    </div>
  );
}
