'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTradeChart, deleteAttachment } from '@/lib/journal-actions';

interface Screenshot {
  id: number;
  fileName: string;
}

interface ChartScreenshotProps {
  sessionDate: string;
  firstExecId: string;
  screenshot: Screenshot | null;
}

/**
 * Single chart screenshot for a trade — drag-and-drop or click to upload,
 * replaces the existing chart on a new upload (one screenshot per trade).
 *
 * Future: replace the manual upload with a TradingView integration that pulls
 * the chart automatically and overlays entry/exit points.
 */
export function ChartScreenshot({ sessionDate, firstExecId, screenshot }: ChartScreenshotProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  // Close the zoom modal on Escape and lock body scroll while it's open.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomed]);

  function upload(file: File) {
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    startTransition(async () => {
      try {
        await setTradeChart(sessionDate, firstExecId, formData);
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      }
    });
  }

  function handleSelect() {
    const file = inputRef.current?.files?.[0];
    if (file) upload(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }

  function handleDelete() {
    if (!screenshot) return;
    if (!confirm('Delete this chart screenshot?')) return;
    startTransition(async () => {
      await deleteAttachment(screenshot.id, sessionDate);
      router.refresh();
    });
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleSelect}
        className="hidden"
      />

      {screenshot ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/uploads/${screenshot.fileName}`}
            alt="Trade chart screenshot"
            onClick={() => setZoomed(true)}
            title="Click to expand"
            className="w-full rounded-[12px] border border-hairline object-contain max-h-[560px] bg-deep cursor-zoom-in"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={isPending}
              className="rounded-full bg-ondark text-canvas px-4 h-9 font-semibold text-sm disabled:opacity-50"
            >
              {isPending ? 'Working…' : 'Replace chart'}
            </button>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-full bg-deep border border-hairline text-stone px-4 h-9 text-sm hover:text-ondark transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`w-full min-h-[360px] rounded-[16px] border-2 border-dashed flex flex-col items-center justify-center gap-3 px-6 text-center transition-colors ${
            dragOver ? 'border-stone bg-lift' : 'border-hairline bg-deep'
          }`}
        >
          <div className="w-12 h-12 rounded-full bg-elevated flex items-center justify-center text-2xl text-stone">
            ⬆
          </div>
          <div className="font-display text-lg text-ondark">
            {isPending ? 'Uploading…' : 'Upload chart screenshot'}
          </div>
          <p className="text-sm text-stone max-w-xs">
            Drag &amp; drop your chart image here, or click to browse. PNG, JPEG, or WebP.
          </p>
        </button>
      )}

      {error && <p className="text-sm text-loss mt-3">{error}</p>}

      {zoomed && screenshot && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded chart"
        >
          <button
            onClick={() => setZoomed(false)}
            aria-label="Close expanded chart"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-elevated/80 text-ondark text-lg flex items-center justify-center hover:bg-elevated transition-colors"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/uploads/${screenshot.fileName}`}
            alt="Trade chart screenshot"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-[8px]"
          />
        </div>
      )}
    </div>
  );
}
