'use client';

import { useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { uploadAttachment, deleteAttachment } from '@/lib/journal-actions';

interface Attachment {
  id: number;
  fileName: string;
  caption?: string | null;
}

interface AttachmentGalleryProps {
  sessionDate: string;
  attachments: Attachment[];
  /** When set, uploads are tied to this specific trade instead of the session. */
  firstExecId?: string | null;
}

export function AttachmentGallery({ sessionDate, attachments, firstExecId }: AttachmentGalleryProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    startTransition(async () => {
      await uploadAttachment(sessionDate, formData, firstExecId);
      // Clear the file input
      if (fileInputRef.current) fileInputRef.current.value = '';
      router.refresh();
    });
  }

  function handleDelete(id: number, fileName: string) {
    if (!confirm(`Delete screenshot "${fileName}"?`)) return;
    startTransition(async () => {
      await deleteAttachment(id, sessionDate);
      router.refresh();
    });
  }

  return (
    <div>
      {attachments.length === 0 ? (
        <p className="text-stone text-sm mb-4">No screenshots yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {attachments.map((att) => (
            <div key={att.id} className="relative group">
              <a
                href={`/api/uploads/${att.fileName}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/uploads/${att.fileName}`}
                  alt={att.caption ?? att.fileName}
                  className="rounded-[12px] w-full h-32 object-cover border border-hairline"
                />
              </a>
              {/* Delete button — visible on hover */}
              <button
                onClick={() => handleDelete(att.id, att.fileName)}
                className="absolute top-1.5 right-1.5 bg-canvas/70 rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-ondark"
                title="Delete"
              >
                ✕
              </button>
              {att.caption && (
                <p className="text-[12px] text-stone mt-1 truncate">{att.caption}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload row */}
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="text-sm text-stone file:mr-3 file:bg-deep file:border file:border-hairline file:rounded-full file:px-3 file:py-1 file:text-xs file:text-ondark file:cursor-pointer"
        />
        <button
          onClick={handleUpload}
          disabled={isPending}
          className="rounded-full bg-ondark text-canvas px-6 h-10 font-semibold text-sm disabled:opacity-50 shrink-0"
        >
          {isPending ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </div>
  );
}
