'use client';

import { useState, useTransition } from 'react';
import { createSetupFromSuggestion, saveAnnotation } from '@/lib/journal-actions';
import { Pnl } from '@/components/pnl';
import { useUnsavedWarning } from '@/lib/use-unsaved-warning';
import { useSpeechRecognition } from '@/lib/use-speech-recognition';
import { synthesizeTradeNotesAction } from '@/lib/voice-actions';
import type { SetupSuggestion } from '@/lib/setup-suggestions';

interface SetupOption {
  number: number;
  name: string;
}

interface TradeHeader {
  firstExecId: string;
  label: string;     // e.g. "NVDA 170P"
  sub: string;       // e.g. "06:35"
  pnl: number;
}

interface AnnotationEditorProps {
  trade: TradeHeader;
  sessionDate: string;
  setups: SetupOption[];
  aiConfigured: boolean;
  aiMissingMessage: string;
  underlying: string;
  direction: string;
  initial: {
    setupNumber?: number | null;
    thesis?: string | null;
    executionNotes?: string | null;
    grade?: string | null;
    gradeReason?: string | null;
    setupSuggestion?: SetupSuggestion | null;
  } | null;
}

const INPUT_CLS =
  'bg-deep border border-hairline rounded-[12px] px-4 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone';
const LABEL_CLS = 'text-[13px] uppercase tracking-wide text-stone mb-1 block';

const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'] as const;

function serialize(
  setupNumber: string,
  grade: string,
  gradeReason: string,
  thesis: string,
  executionNotes: string,
  setupSuggestion: SetupSuggestion | null,
): string {
  return [
    setupNumber,
    grade,
    gradeReason,
    thesis,
    executionNotes,
    JSON.stringify(setupSuggestion),
  ].join('\x00');
}

export function AnnotationEditor({
  trade,
  sessionDate,
  setups,
  aiConfigured,
  aiMissingMessage,
  underlying,
  direction,
  initial,
}: AnnotationEditorProps) {
  const [setupOptions, setSetupOptions] = useState(setups);
  const [setupNumber, setSetupNumber] = useState(
    initial?.setupNumber != null ? String(initial.setupNumber) : '',
  );
  const [grade, setGrade] = useState(initial?.grade ?? '');
  const [gradeReason, setGradeReason] = useState(initial?.gradeReason ?? '');
  const [thesis, setThesis] = useState(initial?.thesis ?? '');
  const [executionNotes, setExecutionNotes] = useState(initial?.executionNotes ?? '');
  const [setupSuggestion, setSetupSuggestion] = useState<SetupSuggestion | null>(
    initial?.setupSuggestion ?? null,
  );

  const [baseline, setBaseline] = useState(() =>
    serialize(
      initial?.setupNumber != null ? String(initial.setupNumber) : '',
      initial?.grade ?? '',
      initial?.gradeReason ?? '',
      initial?.thesis ?? '',
      initial?.executionNotes ?? '',
      initial?.setupSuggestion ?? null,
    ),
  );

  const isDirty =
    serialize(setupNumber, grade, gradeReason, thesis, executionNotes, setupSuggestion) !== baseline;
  useUnsavedWarning(isDirty, `annot:${trade.firstExecId}`);

  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const sr = useSpeechRecognition();
  const [voicePending, startVoice] = useTransition();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [setupPending, startSetup] = useTransition();
  const [setupError, setSetupError] = useState<string | null>(null);

  function handleFillWithAI() {
    setVoiceError(null);
    setSetupError(null);
    startVoice(async () => {
      try {
        const r = await synthesizeTradeNotesAction(sr.transcript, {
          underlying,
          direction,
          pnl: trade.pnl,
        });
        setSetupNumber(r.setupNumber != null ? String(r.setupNumber) : '');
        setGrade(r.grade ?? '');
        setGradeReason(r.gradeReason ?? '');
        setThesis(r.thesis);
        setExecutionNotes(r.executionNotes);
        setSetupSuggestion(r.setupSuggestion);
        sr.reset();
      } catch (e) {
        setVoiceError(e instanceof Error ? e.message : 'Could not fill from voice');
      }
    });
  }

  function handleSetupChange(value: string) {
    setSetupNumber(value);
    if (value !== '') setSetupSuggestion(null);
  }

  function handleSave() {
    startTransition(async () => {
      await saveAnnotation(trade.firstExecId, sessionDate, {
        setupNumber: setupNumber !== '' ? parseInt(setupNumber, 10) : null,
        grade: grade || null,
        gradeReason: gradeReason || null,
        thesis: thesis || null,
        executionNotes: executionNotes || null,
        setupSuggestion,
      });
      setBaseline(serialize(setupNumber, grade, gradeReason, thesis, executionNotes, setupSuggestion));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function handleCreateSetup() {
    if (!setupSuggestion) return;
    setSetupError(null);
    startSetup(async () => {
      try {
        const created = await createSetupFromSuggestion(
          trade.firstExecId,
          sessionDate,
          setupSuggestion,
        );
        setSetupOptions((current) => [
          ...current,
          { number: created.setupNumber, name: setupSuggestion.name },
        ]);
        await saveAnnotation(trade.firstExecId, sessionDate, {
          setupNumber: created.setupNumber,
          grade: grade || null,
          gradeReason: gradeReason || null,
          thesis: thesis || null,
          executionNotes: executionNotes || null,
          setupSuggestion: null,
        });
        setSetupNumber(String(created.setupNumber));
        setSetupSuggestion(null);
        setBaseline(serialize(String(created.setupNumber), grade, gradeReason, thesis, executionNotes, null));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setSetupError(e instanceof Error ? e.message : 'Could not create setup');
      }
    });
  }

  return (
    <div className="bg-deep rounded-[12px] p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <span className="text-ondark font-semibold text-sm">{trade.label}</span>
          <span className="text-stone text-sm ml-2">· {trade.sub}</span>
        </div>
        <Pnl value={trade.pnl} />
      </div>

      {/* Voice capture */}
      <div className="mb-4 rounded-[12px] bg-deep p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {sr.supported ? (
            <button
              type="button"
              onClick={() => (sr.recording ? sr.stop() : sr.start())}
              className={`rounded-full px-4 h-9 font-semibold text-sm transition-colors ${
                sr.recording ? 'bg-loss text-white' : 'bg-ondark text-canvas'
              }`}
            >
              {sr.recording ? '■ Stop' : '🎤 Record trade'}
            </button>
          ) : (
            <span className="text-[13px] text-stone">
              Voice capture needs Chrome or Safari — type below or use WhisperFlow.
            </span>
          )}

          {sr.transcript && !sr.recording && (
            <>
              <button
                type="button"
                onClick={handleFillWithAI}
                disabled={voicePending || !aiConfigured}
                className="rounded-full bg-elevated border border-hairline text-ondark px-4 h-9 font-semibold text-sm disabled:opacity-50"
              >
                {voicePending ? 'Filling…' : 'Fill with AI'}
              </button>
              <button
                type="button"
                onClick={() => sr.reset()}
                className="text-[13px] text-stone hover:text-ondark transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>

        {!aiConfigured && sr.transcript && (
          <p className="text-[13px] text-stone mt-2">
            {aiMissingMessage}
          </p>
        )}
        {sr.transcript && (
          <p className="text-sm text-mute mt-3 whitespace-pre-wrap">{sr.transcript}</p>
        )}
        {sr.error && <p className="text-sm text-loss mt-2">{sr.error}</p>}
        {voiceError && <p className="text-sm text-loss mt-2">{voiceError}</p>}
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Setup select */}
        <div>
          <label className={LABEL_CLS}>Setup</label>
          <select
            value={setupNumber}
            onChange={(e) => handleSetupChange(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">—</option>
            {setupOptions.map((s) => (
              <option key={s.number} value={String(s.number)}>
                {s.number} — {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Grade select */}
        <div>
          <label className={LABEL_CLS}>Grade</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">—</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          {gradeReason && (
            <div className="mt-3 rounded-[12px] border border-hairline bg-elevated p-3">
              <p className="text-[13px] uppercase tracking-wide text-stone mb-1">
                AI grade reason
              </p>
              <p className="text-sm text-mute leading-relaxed">{gradeReason}</p>
            </div>
          )}
        </div>

        {/* Thesis */}
        <div>
          <label className={LABEL_CLS}>Thesis</label>
          <textarea
            rows={8}
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="Why did you take this trade?"
            className={INPUT_CLS + ' resize-none'}
          />
        </div>

        {/* Execution notes */}
        <div>
          <label className={LABEL_CLS}>Execution notes</label>
          <textarea
            rows={8}
            value={executionNotes}
            onChange={(e) => setExecutionNotes(e.target.value)}
            placeholder="Entry, sizing, management, exit…"
            className={INPUT_CLS + ' resize-none'}
          />
        </div>
      </div>

      {setupSuggestion && (
        <div className="mt-4 rounded-[12px] border border-hairline bg-elevated p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[13px] uppercase tracking-wide text-stone mb-1">
                Possible new setup
              </p>
              <p className="text-sm font-semibold text-ondark">{setupSuggestion.name}</p>
            </div>
            <span className="rounded-full bg-deep px-3 py-0.5 text-[12px] text-stone">
              {setupSuggestion.confidence === 'none' ? 'No setup match' : 'Weak setup match'}
            </span>
          </div>
          <p className="mt-3 text-sm text-mute leading-relaxed">{setupSuggestion.description}</p>
          <div className="mt-3">
            <p className="text-[13px] uppercase tracking-wide text-stone mb-1">Entry criteria</p>
            <p className="text-sm text-mute leading-relaxed">{setupSuggestion.entryCriteria}</p>
          </div>
          <p className="mt-3 text-[13px] text-stone">{setupSuggestion.reason}</p>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleCreateSetup}
              disabled={setupPending}
              className="rounded-full bg-ondark text-canvas px-4 h-8 font-semibold text-sm disabled:opacity-50"
            >
              {setupPending ? 'Creating…' : 'Create setup'}
            </button>
            <button
              type="button"
              onClick={() => setSetupSuggestion(null)}
              className="text-[13px] text-stone hover:text-ondark transition-colors"
            >
              Dismiss
            </button>
          </div>
          {setupError && <p className="text-sm text-loss mt-2">{setupError}</p>}
        </div>
      )}

      {/* Save row */}
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-full bg-ondark text-canvas px-4 h-8 font-semibold text-sm disabled:opacity-50"
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
