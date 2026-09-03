'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSetup } from '@/lib/setup/actions';
import { setupPayload } from '@/lib/setup/form-payload';
import { waitForSetupArea } from '@/lib/setup/use-setup-status';
import type { SetupArea } from '@/lib/setup/state';

export function useSectionForm({
  initial,
  masked,
  area,
  onSaved,
}: {
  initial: Record<string, string>;
  masked: readonly string[];
  /** Which area to wait for after saving. Omit for a section whose values do
   * not change any area's configured/unconfigured status, such as the rule
   * thresholds. */
  area?: SetupArea;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Lines to paste into .env by hand when writing it failed. */
  const [fallback, setFallback] = useState<string | null>(null);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const payload = setupPayload(values, initial, masked);
    if (Object.keys(payload).length === 0) {
      setMessage('Nothing changed.');
      return;
    }

    setSaving(true);
    setMessage('Saving…');
    setFallback(null);
    try {
      await saveSetup(payload);
      if (!area) {
        setMessage('Saved.');
      } else {
        // The dev server restarts itself when .env changes; until it is back,
        // the value is on disk but not in the running process.
        setMessage('Saved. Waiting for the server to reload…');
        const live = await waitForSetupArea(area);
        setMessage(
          live
            ? 'Saved and live.'
            : 'Saved to .env. Restart the server for it to take effect.',
        );
      }
      onSaved?.();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save.');
      // A read-only checkout or a root-owned .env is the realistic cause, and
      // it is not something the user can fix from this page — so hand them the
      // exact lines instead of leaving them with an error and no route through.
      setFallback(
        Object.entries(payload)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
      );
    } finally {
      setSaving(false);
    }
  }

  return { values, set, save, saving, message, fallback };
}
