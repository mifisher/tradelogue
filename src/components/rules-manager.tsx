'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createTradingRule,
  deleteTradingRule,
  toggleTradingRule,
  updateTradingRule,
} from '@/lib/rule-actions';

export interface RuleManagerRow {
  id: number;
  ruleNumber: number;
  title: string;
  description: string;
  enabled: boolean;
  detector: string | null;
  source: string;
}

export interface RuleCandidate {
  title: string;
  description: string;
}

interface RulesManagerProps {
  initialRules: RuleManagerRow[];
  candidates: RuleCandidate[];
}

const INPUT_CLS =
  'bg-deep border border-hairline rounded-[12px] px-4 py-3 text-sm text-ondark w-full focus:outline-none focus:border-stone';
const LABEL_CLS = 'text-[13px] uppercase tracking-wide text-stone mb-1 block';

function blankDraft(): RuleCandidate {
  return { title: '', description: '' };
}

function candidateDescription(candidate: RuleCandidate): string {
  return candidate.description.trim();
}

export function RulesManager({ initialRules, candidates }: RulesManagerProps) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState<RuleCandidate>(blankDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<RuleCandidate>(blankDraft);
  const [pendingId, setPendingId] = useState<number | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.ruleNumber - b.ruleNumber),
    [rules],
  );

  function refresh() {
    router.refresh();
  }

  function handleCreate() {
    setPendingId('new');
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await createTradingRule({
          title: draft.title,
          description: draft.description,
          enabled: true,
        });
        setRules((current) => [
          ...current,
          {
            id: result.id,
            ruleNumber: result.ruleNumber,
            title: draft.title.trim(),
            description: draft.description.trim(),
            enabled: true,
            detector: null,
            source: 'manual',
          },
        ]);
        setDraft(blankDraft());
        setMessage(`Rule ${result.ruleNumber} created.`);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create rule');
      } finally {
        setPendingId(null);
      }
    });
  }

  function startEditing(rule: RuleManagerRow) {
    setEditingId(rule.id);
    setEditDraft({ title: rule.title, description: rule.description });
    setMessage(null);
    setError(null);
  }

  function handleUpdate(rule: RuleManagerRow) {
    setPendingId(rule.id);
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        await updateTradingRule(rule.id, {
          title: editDraft.title,
          description: editDraft.description,
          enabled: rule.enabled,
        });
        setRules((current) =>
          current.map((item) =>
            item.id === rule.id
              ? {
                  ...item,
                  title: editDraft.title.trim(),
                  description: editDraft.description.trim(),
                }
              : item,
          ),
        );
        setEditingId(null);
        setMessage(`Rule ${rule.ruleNumber} updated.`);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update rule');
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleToggle(rule: RuleManagerRow) {
    const nextEnabled = !rule.enabled;
    setPendingId(rule.id);
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        await toggleTradingRule(rule.id, nextEnabled);
        setRules((current) =>
          current.map((item) =>
            item.id === rule.id ? { ...item, enabled: nextEnabled } : item,
          ),
        );
        setMessage(`Rule ${rule.ruleNumber} ${nextEnabled ? 'enabled' : 'disabled'}.`);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update rule status');
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleDelete(rule: RuleManagerRow) {
    if (!window.confirm(`Delete Rule ${rule.ruleNumber}: ${rule.title}?`)) return;
    setPendingId(rule.id);
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        await deleteTradingRule(rule.id);
        setRules((current) => current.filter((item) => item.id !== rule.id));
        setMessage(`Rule ${rule.ruleNumber} deleted.`);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete rule');
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div>
          <h2 className="font-display text-2xl text-ondark">Rulebook</h2>
          <p className="mt-2 text-sm text-stone leading-relaxed">
            Enabled auto-scored rules affect discipline violations immediately. Manual rules are tracked here as operating constraints until they are wired to a detector.
          </p>
        </div>

        <div className="rounded-[12px] border border-hairline bg-elevated p-5">
          <h3 className="font-display text-xl text-ondark mb-4">Add rule</h3>
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Title</label>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                className={INPUT_CLS}
                placeholder="No trades before 7:00 AM"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Rule</label>
              <textarea
                rows={5}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                className={INPUT_CLS + ' resize-none'}
                placeholder="Describe the constraint, evidence, and what counts as a violation."
              />
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={pendingId === 'new'}
              className="rounded-full bg-ondark text-canvas px-5 h-10 font-semibold text-sm disabled:opacity-50"
            >
              {pendingId === 'new' ? 'Creating...' : 'Create rule'}
            </button>
          </div>
        </div>
      </section>

      {candidates.length > 0 && (
        <section>
          <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-display text-2xl text-ondark">Suggested candidates</h2>
              <p className="mt-1 text-sm text-stone">
                Drafted from the latest pattern analysis experiments.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {candidates.map((candidate) => (
              <article key={candidate.title} className="rounded-[12px] border border-hairline bg-elevated p-5">
                <h3 className="font-display text-xl text-ondark">{candidate.title}</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm text-mute leading-relaxed">
                  {candidateDescription(candidate)}
                </p>
                <button
                  type="button"
                  onClick={() => setDraft(candidate)}
                  className="mt-4 rounded-full border border-hairline px-4 h-8 text-sm font-semibold text-stone hover:text-ondark"
                >
                  Use as draft
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-4">
        {sortedRules.map((rule) => {
          const isEditing = editingId === rule.id;
          const isPending = pendingId === rule.id;
          return (
            <article key={rule.id} className="rounded-[12px] border border-hairline bg-elevated p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-deep rounded-full px-3 py-0.5 text-[13px] text-stone shrink-0">
                      R{rule.ruleNumber}
                    </span>
                    <span className={`rounded-full px-3 py-0.5 text-[12px] ${rule.enabled ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span className="rounded-full bg-deep px-3 py-0.5 text-[12px] text-stone">
                      {rule.detector ? 'Auto-scored' : 'Manual'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className={LABEL_CLS}>Title</label>
                        <input
                          value={editDraft.title}
                          onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))}
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Rule</label>
                        <textarea
                          rows={4}
                          value={editDraft.description}
                          onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}
                          className={INPUT_CLS + ' resize-none'}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="mt-4 font-display text-xl text-ondark">{rule.title}</h3>
                      <p className="mt-2 text-sm text-mute leading-relaxed whitespace-pre-wrap">
                        {rule.description}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3 flex-wrap">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleUpdate(rule)}
                      disabled={isPending}
                      className="rounded-full bg-ondark text-canvas px-4 h-8 font-semibold text-sm disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={isPending}
                      className="rounded-full border border-hairline px-4 h-8 text-sm font-semibold text-stone hover:text-ondark disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEditing(rule)}
                      disabled={isPending}
                      className="rounded-full border border-hairline px-4 h-8 text-sm font-semibold text-stone hover:text-ondark disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggle(rule)}
                      disabled={isPending}
                      className="rounded-full border border-hairline px-4 h-8 text-sm font-semibold text-stone hover:text-ondark disabled:opacity-50"
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rule)}
                      disabled={isPending}
                      className="rounded-full border border-hairline px-4 h-8 text-sm font-semibold text-loss disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {message && <p className="text-sm text-gain">{message}</p>}
      {error && <p className="text-sm text-loss">{error}</p>}
    </div>
  );
}
